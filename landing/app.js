// Showreel source switch and the design-partner form. No tracking, no dependencies.
(() => {
  // Entrance for section parts as they scroll in. Added by script, so without JS or with reduced motion nothing is hidden.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -5% 0px' });
    document.querySelectorAll('.intro > *, .flow-text, .flow-fig, .modmap, .ba-col')
      .forEach((el, i) => { el.style.transitionDelay = `${(i % 3) * 70}ms`; el.classList.add('rv'); io.observe(el); });
  }

  // Showreel: serve the vertical cut on phones (a <video> can't switch sources by media query).
  const vid = document.getElementById('reel-video');
  if (vid) {
    const narrow = matchMedia('(max-width: 640px)');
    const pick = () => {
      if (!vid.paused) return;
      const v9 = narrow.matches;
      if (vid.classList.contains('v9') === v9) return;
      const k = v9 ? '9x16' : '16x9';
      vid.classList.toggle('v9', v9);
      vid.width = v9 ? 720 : 1280; vid.height = v9 ? 1280 : 720;
      vid.poster = `/assets/showreel-poster-${k}.webp`;
      vid.querySelectorAll('source').forEach((s) => { s.src = `/assets/showreel-${k}.mp4`; });
      vid.load();
    };
    pick(); narrow.addEventListener('change', pick);
  }

  const form = document.getElementById('apply-form');
  if (!form) return;
  const status = document.getElementById('status');
  const submit = document.getElementById('submit');
  const started = Date.now();
  const FIELDS = ['name', 'email', 'company', 'role', 'phone', 'size', 'business', 'fix', 'consent'];
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const setErr = (k, msg) => {
    const input = form.elements[k];
    const out = document.getElementById(`e-${k}`);
    if (!input || !out) return;
    out.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  };
  const clearAll = () => { FIELDS.forEach((k) => setErr(k, '')); summary.hidden = true; list.replaceChildren(); };
  const summary = document.getElementById('summary');
  const list = document.getElementById('summary-list');
  const showSummary = (errs) => {
    list.replaceChildren(...Object.entries(errs).map(([k, m]) => {
      const li = document.createElement('li'); const a = document.createElement('a');
      a.href = `#${form.elements[k].id}`; a.textContent = m; li.append(a); return li;
    }));
    summary.hidden = false; summary.focus();
  };
  const values = () => {
    const fd = new FormData(form);
    const v = Object.fromEntries(FIELDS.map((k) => [k, (fd.get(k) ?? '').toString().trim()]));
    v.consent = form.elements.consent.checked;
    return v;
  };

  const validate = (v) => {
    const e = {};
    if (!v.name) e.name = 'Enter your name.';
    if (!v.email) e.email = 'Enter your work email.';
    else if (!EMAIL.test(v.email)) e.email = 'Enter a valid email address, like name@company.com.';
    if (!v.company) e.company = 'Enter your company.';
    if (!v.role) e.role = 'Enter your role.';
    if (!v.consent) e.consent = 'Tick this box so we can reply to you.';
    return e;
  };

  const say = (cls, text, retry) => {
    status.className = `status ${cls}`;
    status.textContent = text;
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-sm retry'; b.textContent = 'Try again';
      b.addEventListener('click', () => form.requestSubmit());
      status.append(b);
    }
  };

  form.addEventListener('input', (ev) => { if (ev.target.name) setErr(ev.target.name, ''); });
  // Validate a filled field when the user leaves it; empty ones wait for submit.
  form.addEventListener('focusout', (ev) => {
    const k = ev.target.name;
    if (!k || !FIELDS.includes(k) || k === 'consent' || !ev.target.value.trim()) return;
    setErr(k, validate(values())[k]);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearAll();
    status.textContent = '';
    const v = values();
    const errs = validate(v);
    const bad = Object.keys(errs);
    if (bad.length) {
      bad.forEach((k) => setErr(k, errs[k]));
      showSummary(errs);
      return;
    }
    submit.disabled = true;
    say('', 'Sending…');
    try {
      const res = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...v, website: form.elements.website.value, started }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        form.reset();
        say('ok', "Thanks. We'll reply within one business day.");
      } else if (data.fields) {
        const known = Object.fromEntries(Object.entries(data.fields).filter(([k]) => form.elements[k]));
        Object.entries(known).forEach(([k, m]) => setErr(k, m));
        showSummary(known);
      } else {
        say('bad', data.error || 'Something went wrong.', true);
      }
    } catch {
      say('bad', 'We could not reach the server. Check your connection.', true);
    } finally {
      submit.disabled = false;
    }
  });
})();
