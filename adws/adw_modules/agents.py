"""Config loading/validation and agent execution.

Every ADW validates its agents before running (fail fast, nothing spawns
against a half-valid config). Every agent call parses against a concrete
output type; parse failures and gate violations re-prompt the SAME session
with a correction — context intact, bounded retries. Agent proposes, code
disposes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

import yaml

from . import agent_pi, permissions, prompts
from .data_types import (AgentCall, AgentConfig, EnvelopeBase, EventRecord,
                         GateCheck, GateReport, Phase, PiRequest, SSSFConfig,
                         UsageBreakdown)
from .utils import new_id

JSON_FIX_ATTEMPTS = 2      # continue-with-correction attempts for malformed JSON


class GateFailure(RuntimeError):
    pass


# ── config ───────────────────────────────────────────────────────────────────

def load_config(path: str = "adws/adw_sssf_config/sssf.config.yaml") -> SSSFConfig:
    raw = yaml.safe_load(Path(path).read_text()) or {}
    defaults = raw.get("defaults", {}) or {}
    for agent in raw.get("agents", []) or []:
        for key in ("coding_agent", "model", "thinking", "color", "tools", "writes"):
            if key in defaults:
                agent.setdefault(key, defaults[key])
        agent.setdefault("harness_engineering", defaults.get("harness_engineering", []))
    return SSSFConfig(**raw)


def resolve(cfg: SSSFConfig, name: str) -> AgentConfig:
    for agent in cfg.agents:
        if agent.name == name:
            return agent
    raise SystemExit(f"agent {name!r} is not defined in the config — "
                     f"available: {[a.name for a in cfg.agents]}")


def validate(cfg: SSSFConfig, required: list[str]) -> None:
    """Fail fast: every required name must resolve to a usable agent."""
    problems = []
    for name in required:
        try:
            agent = resolve(cfg, name)
        except SystemExit as e:
            problems.append(str(e))
            continue
        if agent.coding_agent != "pi":
            problems.append(f"agent {name!r}: coding_agent {agent.coding_agent!r} "
                            f"is not implemented in v1 (pi only)")
        for label, ref in (("system", agent.prompt_engineering.system),
                           ("user", agent.prompt_engineering.user)):
            if not Path(ref).is_file():
                problems.append(f"agent {name!r}: {label} prompt not found: {ref}")
        # Every RUNG is resolved, not just rung 1. A ladder exists to be used on the
        # worst day; discovering a typo in rung 3 at that moment — mid-chain, with
        # the primary already dead — is the failure the ladder was added to prevent.
        for position, pattern in enumerate([agent.model, *agent.fallbacks]):
            try:
                agent_pi.resolve_model(pattern)
            except ValueError as e:
                where = "model" if position == 0 else f"fallbacks[{position - 1}]"
                problems.append(f"agent {name!r}: {where}: {e}")
    if problems:
        raise SystemExit("config validation failed:\n- " + "\n- ".join(problems))


# ── execution ────────────────────────────────────────────────────────────────

def execute(run, phase: Phase, call: AgentCall) -> EnvelopeBase:
    """One agent call: render prompts -> pi run -> typed parse -> gates -> envelope."""
    agent = resolve(run.cfg, phase.params.owner)
    agent_dir = run.session_dir / agent.name
    agent_dir.mkdir(parents=True, exist_ok=True)

    variables = {
        "prompt": call.prompt,
        "previous_envelope": call.previous.model_dump_json(indent=2) if call.previous else "(none)",
        "context_handoff_dir": str(run.context_handoff_dir),
    }
    system_text = prompts.render(agent.prompt_engineering.system, variables)
    if agent.contract:
        # Appended after render, verbatim — contract text is not a template.
        contract_text = (run.repo_root / agent.contract).read_text()
        system_text += (f"\n\n# Role contract (appended mechanically from {agent.contract})\n\n"
                        + contract_text)
    user_text = prompts.render(agent.prompt_engineering.user, variables)
    prompts.save(agent_dir / "prompts", "system.md", system_text)
    prompts.save(agent_dir / "prompts", "user.md", user_text)

    session_id = _agent_session_id(run, agent)
    run.tracer.event(EventRecord(adw_id=run.adw_id, phase_id=phase.phase_id,
                                 type="agent_start", name=agent.name,
                                 payload={"model": agent.model, "thinking": agent.thinking,
                                          "color": agent.color,
                                          "session_id": session_id,
                                          "coding_agent": agent.coding_agent,
                                          "purpose": agent.purpose,
                                          "tools": agent.tools,  # None = all tools
                                          "harness_engineering": agent.harness_engineering}))
    run.console.agent_started(agent.name, agent.model, session_id)

    # Parse retries and gate corrections re-enter the SAME pi session, so the
    # last send is the one whose context occupancy is current — while spend is
    # the opposite: every send costs, so usage accumulates across all of them.
    latest: agent_pi.PiResult | None = None
    spent = UsageBreakdown()

    # Rung 1 is `model`; `fallbacks` follow IN ORDER. `active_model`/`active_session`
    # are what the CURRENT rung is using — once a rung answers, every later send in
    # this phase (parse retries, gate corrections) stays on it, because those
    # corrections only make sense inside the session that produced the response.
    ladder = [agent.model, *agent.fallbacks]
    active = {"model": agent.model, "session": session_id, "rung": 0}

    def send(prompt_text: str) -> agent_pi.PiResult:
        nonlocal latest
        # A rung is only abandoned when it answered with NOTHING and named a
        # provider error — a capped quota, a rejected key, an outage. A rung that
        # produced text owns the phase, wrong answers included: hopping on a bad
        # answer would silently re-roll the dice on a different substrate and hide
        # the real failure, which is the opposite of what this is for.
        for index in range(active["rung"], len(ladder)):
            model = ladder[index]
            # Each rung gets its OWN pi session: a session file carries the
            # previous provider's turns, and replaying those into another
            # provider's context is not a resume, it is a different conversation.
            session = session_id if index == 0 else f"{session_id}-r{index}"
            result = _send_once(prompt_text, model, session)
            answered = bool(result.text.strip())
            if answered or not result.provider_error or index == len(ladder) - 1:
                if not answered and result.provider_error:
                    # Last rung, still nothing. Surface the PROVIDER's words —
                    # the caller would otherwise report a JSON parse error for
                    # what is an outage, which is exactly the 2026-08-20 misread.
                    run.console.retry(agent.name, index + 1, len(ladder),
                                      f"substrate exhausted: {result.provider_error}")
                active["rung"] = index
                active["model"] = model
                active["session"] = session
                return result
            run.tracer.event(EventRecord(
                adw_id=run.adw_id, phase_id=phase.phase_id, type="substrate_fallback",
                name=agent.name,
                payload={"from": model, "to": ladder[index + 1],
                         "provider_error": result.provider_error, "rung": index}))
            run.console.retry(agent.name, index + 1, len(ladder),
                              f"{model} did not answer ({result.provider_error}) — "
                              f"falling back to {ladder[index + 1]}")
        raise RuntimeError(f"{agent.name}: no substrate on the ladder answered ({ladder})")

    def _send_once(prompt_text: str, model: str, session: str) -> agent_pi.PiResult:
        nonlocal latest
        request = PiRequest(
            prompt=prompt_text,
            system_prompt=system_text,
            model=model,
            thinking=agent.thinking,
            session_id=session,
            # absolute: these are read by the pi subprocess, which runs in repo_root
            session_dir=str((agent_dir / "pi_sessions").resolve()),
            raw_output_path=str((agent_dir / "raw_output.jsonl").resolve()),
            tools=agent.tools,
            extensions=agent.harness_engineering,
            cwd=str(run.repo_root),
        )
        result = agent_pi.run(
            request,
            on_event=_event_forwarder(run, phase, agent.name),
            on_spawn=lambda pid: run.tracer.process_start(
                run.adw_id, "agent", agent.name, pid,
                f"{agent.coding_agent} {agent.name} {model}"),
            on_exit=lambda pid: run.tracer.process_end(run.adw_id, pid))
        run.add_usage(result.tokens, result.cost)
        spent.merge(result.usage)
        latest = result
        return result

    # What the tree looked like before this agent got its hands on it. Every
    # send in this phase — first prompt, JSON retries, gate corrections — is
    # measured against this one baseline.
    tree_before = permissions.snapshot(run)

    result = send(user_text)
    envelope, attempt = _parse_with_retries(run, phase, call, result, send)

    # claim gates — violations flow back into the SAME session as corrections
    for gate_attempt in range(1, max(1, phase.params.retries + 1) + 1):
        violations = []
        for gate in call.gates:
            report = _as_report(gate(envelope, run))
            found = report.violations
            run.tracer.gate_row(phase, gate.__name__, report, gate_attempt)
            run.tracer.event(EventRecord(
                adw_id=run.adw_id, phase_id=phase.phase_id,
                type="gate_fail" if found else "gate_pass", name=gate.__name__,
                payload={"attempt": gate_attempt, "violations": found,
                         "checks": [c.model_dump() for c in report.checks]}))
            run.console.gate_result(gate.__name__, report)
            violations.extend(found)
        if not violations:
            break
        if gate_attempt > phase.params.retries:
            raise GateFailure(f"{agent.name} failed gates after {gate_attempt} attempt(s):\n- "
                              + "\n- ".join(violations))
        phase.attempt = gate_attempt
        run.console.retry(agent.name, gate_attempt, phase.params.retries,
                          f"{len(violations)} gate violation(s)")
        correction = ("Your previous response failed validation:\n- "
                      + "\n- ".join(violations)
                      + "\n\nFix these problems, then re-emit ONLY your Report JSON.\n\n"
                      + _CORRECTION_ANCHOR)
        result = send(correction)
        envelope, attempt = _parse_with_retries(run, phase, call, result, send)

    # Permission is checked after every send is done, and before the envelope is
    # accepted: an agent does not get to report success on a phase in which it
    # wrote somewhere it was not allowed to.
    try:
        touched = permissions.enforce(run, phase, agent, tree_before)
    except permissions.PermissionBreach as breach:
        run.tracer.event(EventRecord(adw_id=run.adw_id, phase_id=phase.phase_id,
                                     type="error", name="permission_breach",
                                     payload={"agent": agent.name, "error": str(breach),
                                              "writes": agent.writes,
                                              "protected_files": run.cfg.defaults.protected_files}))
        raise
    if touched:
        run.tracer.event(EventRecord(adw_id=run.adw_id, phase_id=phase.phase_id,
                                     type="log", name="paths_touched",
                                     payload={"agent": agent.name, "paths": touched}))

    _persist_envelope(run, phase, agent.name, call, envelope, attempt, valid=True)
    run.console.envelope_summary(envelope)
    context = latest or result
    run.tracer.agent_session_row(run.adw_id, agent, session_id,
                                 context_tokens=context.context_tokens,
                                 context_window=context.context_window)
    run.save_agent_map(agent.name, {"session_id": session_id, "model": agent.model,
                                    "coding_agent": agent.coding_agent})
    run.tracer.event(EventRecord(adw_id=run.adw_id, phase_id=phase.phase_id,
                                 type="handoff", name=agent.name,
                                 payload={"artifacts": envelope.artifacts,
                                          "summary": envelope.summary}))
    run.tracer.event(EventRecord(adw_id=run.adw_id, phase_id=phase.phase_id,
                                 type="agent_end", name=agent.name,
                                 # Phase totals, not the last send's: a retried
                                 # phase paid for every attempt.
                                 tokens=spent.total_tokens,
                                 payload={"cost": spent.total_cost,
                                          "usage": spent.model_dump(),
                                          "context_tokens": context.context_tokens,
                                          "context_window": context.context_window}))
    run.console.agent_finished(agent.name, spent.total_tokens, spent.total_cost)
    if envelope.status != "success":
        # Name what the TREE shows alongside what the agent claims. A `fail` envelope over a
        # modified tree is an under-report, not an absence of work, and the two read identically
        # in a bare status line.
        raise RuntimeError(f"{agent.name} reported status={envelope.status!r}: {envelope.summary}"
                           + (f" (but it touched {len(touched)} path(s): "
                              f"{', '.join(touched[:8])}{' …' if len(touched) > 8 else ''} — the work "
                              f"is on disk; this envelope under-reports it)" if touched else ""))
    return envelope


# A correction is a follow-up turn, not a new task — but a weak substrate reads it as one, answers
# "no task was provided", and picks `status: "fail"` to say so. That is what ended the 2026-08-21
# run: the builder had already made 84 tool calls and modified ten files. The work was done and the
# REPORT was amnesiac. Every correction therefore carries its own frame.
_CORRECTION_ANCHOR = (
    "This is a CORRECTION to your own previous response in this same session, not a new task. Your "
    "work is already on disk. Do NOT start over, and do NOT report failure on the grounds that this "
    "message contains no task — report on the work you have already done. If you genuinely cannot "
    "recall it, run `git status` and `git diff --stat` and report what you find there."
)


# ── internals ────────────────────────────────────────────────────────────────

def _as_report(result) -> GateReport:
    """Accept a GateReport, or a legacy gate that returned a violations list."""
    if isinstance(result, GateReport):
        return result
    return GateReport(checks=[GateCheck(item=str(v), ok=False) for v in (result or [])])


def _agent_session_id(run, agent: AgentConfig) -> str:
    entry = run.agent_map.get(agent.name)
    if entry and entry.get("model") == agent.model:
        return entry["session_id"]           # rejoin the existing context window
    return f"sssf-{run.adw_id}-{agent.name}-{new_id(4)}"


def _event_forwarder(run, phase: Phase, agent_name: str):
    """One tool_call event per real tool call, with its exact args and result."""
    tracker = agent_pi.ToolCallTracker()

    def forward(event: dict) -> None:
        record = tracker.observe(event)
        if record is None:
            return
        # The call's span rides the columns; duration_ms stays in the payload as
        # pi's own authoritative number.
        run.tracer.event(EventRecord(adw_id=run.adw_id, phase_id=phase.phase_id,
                                     type="tool_call", name=record.pop("label"),
                                     started_at=record.pop("started_at", None),
                                     ended_at=record.pop("ended_at", None),
                                     payload={**record, "agent": agent_name}))
    return forward


def _extract_json(text: str) -> dict:
    candidate = text
    if "```" in text:
        for block in text.split("```")[1::2]:
            block = block.removeprefix("json").strip()
            if block.startswith("{"):
                candidate = block
                break
    start, end = candidate.find("{"), candidate.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object found in the response")
    return json.loads(candidate[start:end + 1])


class SubstrateUnavailable(RuntimeError):
    """The model never answered — quota, auth or transport — as opposed to
    answering badly.

    Kept distinct because the two demand opposite responses. A malformed envelope
    is worth a correction round; a terminal 429 is worth waiting or switching
    substrate, and no amount of re-prompting will fix it. Reported as a parse
    failure (the shape it wears downstream) it sends the operator to debug prompts
    and schemas instead (#482, observed twice on 2026-08-19).
    """


# Terminal substrate conditions, matched against the raw transcript. Deliberately
# narrow: a false positive here would mask a real parse bug.
_SUBSTRATE_SIGNS = (
    ("429", "quota or rate limit reached"),
    ("Usage limit reached", "usage limit reached"),
    ("insufficient_quota", "quota exhausted"),
    ("401", "authentication rejected"),
    ("invalid_api_key", "authentication rejected"),
    # Transport. Named in #482 as one of the three classes and missed on the first
    # pass — observed live on run 0eb50919 (planner, repeated `fetch failed`).
    ("fetch failed", "transport failure reaching the substrate"),
    ("ECONNRESET", "transport failure reaching the substrate"),
    ("ETIMEDOUT", "transport failure reaching the substrate"),
    ("socket hang up", "transport failure reaching the substrate"),
    ("529", "substrate overloaded"),
    ("Overloaded", "substrate overloaded"),
)


def _substrate_failure(raw: str) -> str | None:
    """Name the terminal substrate condition in `raw`, or None.

    Only consulted once every parse attempt has already failed, so the question
    is no longer 'is this valid?' but 'why is there nothing to parse?'. A
    transcript carrying a 429 or an auth rejection answers that; anything else
    stays a parse problem and keeps the original error.
    """
    for needle, label in _SUBSTRATE_SIGNS:
        if needle in (raw or ""):
            return label
    return None


def _reset_hint(raw: str) -> str:
    """Surface a reset time when the payload carries one — it turns 'the factory
    is broken' into 'the factory resumes at 22:34'."""
    match = re.search(r"reset at ([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:]{5,8})", raw or "")
    return f" Resets at {match.group(1)}." if match else ""


def _parse_with_retries(run, phase: Phase, call: AgentCall, result, send):
    """Parse the final response against the declared output type; on failure,
    continue the SAME session with a correction (bounded)."""
    for attempt in range(1, JSON_FIX_ATTEMPTS + 2):
        try:
            payload = _extract_json(result.text)
            return call.output_type.model_validate(payload), attempt
        except Exception as error:
            _persist_envelope(run, phase, phase.params.owner, call, None, attempt,
                              valid=False, raw=result.text)
            if attempt > JSON_FIX_ATTEMPTS:
                cause = _substrate_failure(getattr(result, "raw", "") or result.text or "")
                if cause:
                    raw = getattr(result, "raw", "") or result.text or ""
                    raise SubstrateUnavailable(
                        f"{phase.params.owner} never answered — {cause}."
                        f"{_reset_hint(raw)} This is a substrate failure, not a "
                        f"malformed response: retrying the prompt cannot help. "
                        f"Wait for the window or switch substrate.") from error
                raise RuntimeError(
                    f"{phase.params.owner} never produced valid "
                    f"{call.output_type.__name__} JSON: {error}") from error
            run.console.retry(phase.params.owner, attempt, JSON_FIX_ATTEMPTS,
                              f"invalid {call.output_type.__name__} JSON: {error}")
            fields = ", ".join(call.output_type.model_fields.keys())
            result = send(
                f"Your response was not valid JSON for the required structure "
                f"({error}). Respond again with ONLY a JSON object with these "
                f"fields: {fields}. No prose, no code fences.\n\n"
                + _CORRECTION_ANCHOR)


def _persist_envelope(run, phase: Phase, agent_name: str, call: AgentCall,
                      envelope: Optional[EnvelopeBase], attempt: int,
                      valid: bool, raw: str = "") -> None:
    payload_json = envelope.model_dump_json(indent=2) if envelope else json.dumps({"raw": raw[-2000:]})
    run.tracer.envelope_row(phase, agent_name, call.output_type.__name__,
                            payload_json, valid, attempt)
    if envelope:
        record = {"agent_name": agent_name, "purpose": resolve(run.cfg, agent_name).purpose,
                  "output_type": call.output_type.__name__, "attempt": attempt,
                  **envelope.model_dump()}
        (run.session_dir / agent_name / "envelope.json").write_text(json.dumps(record, indent=2))
