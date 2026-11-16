# Human Friction Taxonomy: Definition, Categorisation, Ranking, and Walk Protocols for Business Software

> Research note behind the `friction-walk` skill (`.claude/skill-overrides/friction-walk/`). Sections A, B
> and the sourced parts of C and D report the literature. The severity matrix (D.3) and the agent walk
> protocol (E) are our own synthesis: a proposal, not a published method. The skill is the working
> version; where the two differ, the skill wins.

---

## Section A. What Friction Is, in Plain Words

Human friction in software is any resistance a person experiences between deciding to do something and getting it done.

When software is broken, it crashes, shows a server error, or refuses to run. Friction is different. When friction occurs, the software often works exactly as its programmers intended. The database saves the row, the server responds with a success status code, and the user interface draws the buttons. Yet the human being using it feels stuck, annoyed, confused, or exhausted.

Friction is the waste of human energy. It is the tax an interface collects from human attention, human working memory, and human physical effort that the underlying business task did not require.

In daily life, friction appears as small moments of hesitation, confusion, and delay:
* A worker pauses before a screen because three buttons look identical, and none clearly says "Submit for Approval."
* A technician in the field cannot read a pale grey status label on a tablet in bright daylight.
* A clerk types a customer's tax identification number into a field, only to have the next screen ask for the exact same number again.
* An administrator clicks a "Save" button, sees no spinner or message, and waits five seconds wondering if the click registered or if the system froze.
* An accountant tries to correct a mistyped code, but the form wipes out ten other completed fields without warning.

In consumer software, friction causes people to leave. A shopper abandons an online shopping cart if checkout takes ten taps instead of two. In business software—often called enterprise or line-of-business software—workers cannot leave. They are mandated by their employer to use the system every working day.

Because captive users cannot leave, business software friction does not cause user churn. Instead, it causes:
1. **Compounding operational drag**: A two-second delay or an extra three clicks seems small when examined in isolation. Performed repeatedly across dozens of employees, it wastes hundreds of working hours every month.
2. **Shadow workarounds** [unsourced: operational observation from enterprise software practice]: When an official system is painful, employees invent unsafe coping mechanisms. They keep records in personal spreadsheets, paste passwords on sticky notes, or trade customer details over informal chat channels.
3. **Severe human errors**: When an interface exhausts a person's mental capacity, that person makes mistakes. In business software, these mistakes mean missed shipments, incorrect invoices, regulatory compliance violations, or corrupted inventory records.
4. **Learned helplessness and burnout** [unsourced: operational observation from enterprise software practice]: Workers begin to believe that technology is inherently painful and that any error is their own fault.

Usability is not an aesthetic luxury; it is the measure of how much friction stands between a human goal and its execution.

---

## Section B. Established Categorisations Side by Side

Decades of human-computer interaction (HCI) research, cognitive psychology, and behavioral economics have studied why human beings experience friction when using tools. The table below places the foundational frameworks side by side, cited to their primary owners.

| Framework & Source | Primary Question Asked | How It Defines & Isolates Friction | Core Concepts & Terminology |
| :--- | :--- | :--- | :--- |
| **Norman's Action Cycle & Two Gulfs**<br>Don Norman (*The Design of Everyday Things*, 1988/2013; *Signifiers, Not Affordances*, 2008) | *"Can I do what I want, and do I know what just happened?"* | Friction occurs when there is a mismatch between a person's mental model and the physical realities of the interface. This splits into two distinct gaps: the **Gulf of Execution** (how hard it is to figure out and perform an action) and the **Gulf of Evaluation** (how hard it is to tell what state the system is now in). | • **Affordance**: Physical relationship between object and actor determining possible actions.<br>• **Signifier**: Perceptible signal communicating *where* and *how* to act.<br>• **Mapping**: Spatial or conceptual alignment between controls and outcomes.<br>• **Feedback**: Immediate signal showing the effect of an action.<br>• **Conceptual Model**: The user's internal mental explanation of how the system works. |
| **Nielsen's 10 Usability Heuristics**<br>Jakob Nielsen (1994, Nielsen Norman Group) | *"Does the design violate established rules of human usability?"* | Friction is diagnosed as a violation of one or more of ten empirical principles derived from factor analysis of hundreds of usability problems. | • **Visibility of System Status** (#1)<br>• **Match Between System and Real World** (#2)<br>• **User Control and Freedom** (#3)<br>• **Consistency and Standards** (#4)<br>• **Error Prevention** (#5)<br>• **Recognition Over Recall** (#6)<br>• **Flexibility and Efficiency of Use** (#7)<br>• **Aesthetic and Minimalist Design** (#8)<br>• **Error Recovery** (#9)<br>• **Help and Documentation** (#10) |
| **Cognitive Walkthrough (CW)**<br>Wharton, Rieman, Lewis, & Polson (1994) | *"Will an unfamiliar user be able to figure out each action along the task path?"* | Evaluates the learnability of an interface by stepping through every user action required to complete a task scenario, examining the user's mental state before and after each action. | Four inspection questions per action:<br>1. *Will the user try to achieve the right effect?*<br>2. *Will the user notice that the correct action is available?*<br>3. *Will the user associate the correct action with the effect they want?*<br>4. *If the correct action is taken, will the user see that progress is being made?* |
| **Streamlined Cognitive Walkthrough (SCW)**<br>Rick Spencer (2000, Microsoft / ACM CHI 2000) | *"Can our engineering team identify friction without getting trapped in endless debates?"* | Strips down the 1994 academic walkthrough to fit fast-paced commercial software cycles by reducing the four questions to two and enforcing strict ground rules (e.g., no debating design fixes during the walk). | Two inspection questions per action:<br>1. *Will the user know what to do at this step?*<br>2. *If the user does the right thing, will they know that they did it and that they are making progress?* |
| **Interaction Cost**<br>Raluca Budiu (2013, Nielsen Norman Group) | *"What total tax in human effort does this interface collect?"* | Defines friction as the total sum of mental (cognitive) and physical effort a user must expend to reach their goal. If interaction cost exceeds perceived benefit, users drop out or fail. | • **Physical Cost**: Typing, clicking, tapping, pointing (Fitts's Law), scrolling, screen/device switching.<br>• **Mental Cost**: Attention/scanning, decision-making (Hick's Law), working memory load, comprehension of labels. |
| **Cognitive Load Theory**<br>John Sweller (1988) applied to UX by Kathryn Whitenton (2013, NN/g) | *"Is the interface overwhelming the human brain's working memory?"* | Friction occurs when an interface imposes mental processing demands that exceed the limited capacity of human working memory (typically limited to 3 to 4 chunks at once, Cowan 2001). | • **Intrinsic Load**: Mental effort inherent to the task itself (e.g., complex business logic).<br>• **Extraneous Load**: Wasted mental effort caused by poor design (clutter, ambiguous labels, bad layout).<br>• **Germane Load**: Effort devoted to processing and learning new schemas. |
| **Fogg Behavior Model (FBM)**<br>BJ Fogg (2009, Stanford University / behaviormodel.org) | *"Does the user have the ability to perform the behavior when prompted?"* | Behavior happens when Motivation, Ability, and a Prompt converge ($B = MAP$). Friction is defined as a lack of **Ability** (high task difficulty), which drops the user below the action activation threshold. | Six Simplicity Factors (elements of Ability):<br>1. Time<br>2. Money<br>3. Physical Effort<br>4. Brain Cycles (Cognitive effort)<br>5. Social Deviance<br>6. Non-Routine (Unfamiliarity) |
| **Sludge & Ordeals**<br>Richard Thaler (2018) & Cass Sunstein (2019/2021) | *"Is this friction justified, or is it unjustified waste and administrative burden?"* | In behavioral science, a *nudge* makes a good choice easier, whereas *sludge* is friction (waiting time, excessive paperwork, confusing bureaucracy) that makes it harder for people to achieve their goals. | • **Sludge**: Excessive or unjustified cognitive and administrative friction.<br>• **Sludge Audit**: Systematic accounting of hours, forms, and emotional distress imposed on people.<br>• **Ordeal**: Deliberate hurdle intended to screen participants, which often deters the most vulnerable. |
| **Friction Logging Practice**<br>Documented by Mike Bifulco (2022; secondary account from former employee) | *"What was the step-by-step emotional and technical journey of trying to use this product?"* | A chronological log recording intent, expected vs. actual behavior, emotional reactions (delight vs. confusion), and actionable remedies. | • **BLUF**: Bottom Line Up Front.<br>• **Expectation vs. Reality**: Gap between what user anticipated and what interface produced.<br>• **Paper Cuts**: Small, fixable micro-defects that collectively degrade trust. |

---

## Section C. Recommended Taxonomy for Role Job Walks

### 1. Context: What is a "Role Job Walk"?
A **Role Job Walk** is an evaluation method where an inspector (human evaluator or disciplined agent) walks through an entire real-world business job end-to-end, strictly adopting the persona, knowledge boundaries, tools, and operational constraints of a specific role. Unlike a generic feature check, a role job walk never tests buttons in isolation. It evaluates how the workflow behaves when a person tries to accomplish real work under realistic conditions.

### 2. Mapping the 10 Existing Friction Types to Established Literature
Today, our walk method tracks ten specific user friction types: **hesitate**, **hunt**, **guess**, **repeat**, **backtrack**, **wait or wonder**, **stopped**, **doubt**, **strain**, and **ask someone**. 

Every one of these ten empirical observations directly reflects foundational HCI and psychological principles:

#### 1. Hesitate
* **What the person experiences**: The user stops before acting. Their hand hovers over the mouse or screen. They re-read instructions or stare at the page, unsure whether taking the next step is correct or safe.
* **Literature Foundation**: 
  * **Norman's Gulf of Execution** (Planning and Specifying stages): The user has formed a goal, but cannot readily translate it into an action sequence.
  * **Spencer's Streamlined Cognitive Walkthrough Q1**: Failure of *"Will the user know what to do at this step?"*
  * **Hick's Law** ($T = b \cdot \log_2(n + 1)$): Reaction time increases logarithmically with the number and complexity of choices. When a page presents dozens of competing buttons with equal visual weight, cognitive processing time spikes.
  * **Budiu's Mental Interaction Cost**: Decision-making and risk calculation overhead.

#### 2. Hunt
* **What the person experiences**: The user knows what action they need to take, but cannot find the control, link, button, or data field on the screen. Their eyes scan back and forth across navigation menus, headers, sidebars, and nested tabs.
* **Literature Foundation**:
  * **Norman's Signifiers**: The interface possesses an affordance (the feature exists), but lacks an adequate visible **signifier** communicating *where* the action lives.
  * **Wharton et al. Cognitive Walkthrough Q2**: Failure of *"Will the user notice that the correct action is available?"*
  * **Information Foraging Theory** (Pirolli & Card, 1999): Users hunt along navigational paths guided by "information scent." When link labels are ambiguous or buried in unintuitive categories, the scent fails, forcing exhaustive visual scanning.
  * **Nielsen Heuristic #6 (Recognition over Recall)**: The user is forced to recall where a setting was buried rather than recognizing it on the page.

#### 3. Guess
* **What the person experiences**: The user clicks a button, selects a dropdown option, or toggles a switch without knowing what will actually happen. They take an educated gamble based on cryptic icons, technical jargon, or ambiguous labels.
* **Literature Foundation**:
  * **Norman's Conceptual Models & Natural Mapping**: The designer's mental model does not match the user's mental model. Controls do not clearly map to system outcomes.
  * **Wharton et al. Cognitive Walkthrough Q3**: Failure of *"Will the user associate the correct action with the effect they are trying to achieve?"*
  * **Sweller's Extraneous Cognitive Load**: Mental energy wasted trying to decipher internal engineering jargon or non-standard iconography.

#### 4. Repeat
* **What the person experiences**: The user is forced to enter the same data multiple times, click the same confirmation across multiple screens, or perform identical manual operations that could have been remembered or automated.
* **Literature Foundation**:
  * **Budiu's Physical Interaction Cost**: Superfluous motor effort (keystrokes, taps, pointing movements) that generates no incremental value.
  * **Baymard Institute Form Research**: Studies demonstrate that asking for redundant information (such as requiring separate billing address input when 96% of users have the same shipping address, or splitting full name into multiple inputs) increases form abandonment and typing fatigue.
  * **Fogg's Physical Effort & Time Simplicity Factors**: Unnecessary repetition depletes the user's finite time and physical capacity, dropping ability below the action threshold.
  * **Nielsen Heuristic #7 (Flexibility and Efficiency of Use)**: Lack of accelerators, macros, or smart defaults.

#### 5. Backtrack
* **What the person experiences**: The user navigates forward into a workflow, realizes they are in the wrong place or made an error, and must hit the browser "Back" button, cancel a modal, or click breadcrumbs to return to an earlier state.
* **Literature Foundation**:
  * **Smith's Lostness Metric** ($L$ component $(N/S - 1)^2$): Pauline A. Smith (1996) mathematically defined navigation inefficiency through the ratio of unique pages visited ($N$) to total page visits ($S$). When $S$ significantly exceeds $N$, the user is backtracking and looping.
  * **Norman's Gulf of Evaluation breakdown**: The user acted, discovered upon evaluation that the state does not match their goal, and must reverse course.
  * **Nielsen Heuristic #3 (User Control and Freedom)**: When interfaces lack clear "emergency exits," backtracking becomes punishing, often resulting in lost form data.

#### 6. Wait or Wonder
* **What the person experiences**: The user clicks or taps, but nothing visible happens immediately. The screen does not freeze, but neither does it show a spinner, a progress indicator, or a disabled button state. The user wonders: *"Did it register? Should I click it again? Did it break?"*
* **Literature Foundation**:
  * **Nielsen Heuristic #1 (Visibility of System Status)**: The system fails to provide timely, appropriate feedback on its internal state.
  * **Miller (1968) and Nielsen (1993/2010) Response Time Limits**:
    * **0.1 seconds**: Limit for feeling that the system reacted instantaneously.
    * **1.0 second**: Limit for the user's flow of thought to stay uninterrupted; delays over 1 second require visual indicators.
    * **10 seconds**: Limit for keeping user attention; beyond 10 seconds, users switch tasks or assume system failure.
  * **Norman's Feedback Principle**: Without immediate tactile, auditory, or visual feedback, the user cannot complete the "Perceive" stage of action.

#### 7. Stopped
* **What the person experiences**: The user encounters a complete dead end. A required field rejects valid input without explaining why; a button remains disabled with no explanation; a permission error occurs with no next step; or a crash screen appears. The user cannot finish the task without outside intervention.
* **Literature Foundation**:
  * **ISO 9241-11 Usability Failure (Effectiveness = 0%)**: The user cannot achieve the specified goal with accuracy and completeness.
  * **Nielsen Severity Rating 4 (Usability Catastrophe)**: An insurmountable barrier that halts product usage.
  * **Wharton et al. CW Failure Story**: Total breakdown of the action sequence.

#### 8. Doubt
* **What the person experiences**: The user completes an action (such as submitting an invoice or updating a record), but receives ambiguous confirmation. They wonder: *"Did that actually go through? Did it send an email to the client? Will it charge their account twice?"* They often refresh the page, check logs, or ask a colleague to confirm.
* **Literature Foundation**:
  * **Norman's Gulf of Evaluation** (Interpretation and Comparison stages): The physical feedback provided by the system does not give the user enough evidence to compare the resulting state with their original goal.
  * **Spencer's SCW Q2**: Failure of *"Will the user know that they did the right thing and that progress is being made?"*
  * **Nielsen Heuristic #9 (Error Recovery and Confirmation)**: Lack of explicit, constructive confirmation states that dispel anxiety.

#### 9. Strain
* **What the person experiences**: Physical, sensory, or mental exhaustion. The user squints at tiny 11px font sizes, struggles to click tiny touch targets on a moving tablet, or struggles to keep six different pieces of account information in their head across separate screens.
* **Literature Foundation**:
  * **Sweller's Cognitive Load Theory**: Working memory overload caused by extraneous interface demands (e.g., memorizing an order number from Screen A to type into Screen B; Nelson Cowan 2001 establishes that human working memory capacity is limited to roughly 4 chunks).
  * **Fitts's Law** ($	ext{Movement Time} = a + b \cdot \log_2(2D / W)$): When target width ($W$) is small and distance ($D$) is large, motor strain and pointing error rates escalate drastically.
  * **Nielsen Heuristic #8 (Aesthetic and Minimalist Design)**: Dense visual noise that taxes visual acuity and attention filtering.

#### 10. Ask Someone
* **What the person experiences**: The user gives up on self-service interaction and turns to a colleague, posts in a Slack help channel, calls IT support, or consults an informal "cheat sheet" pinned to their monitor.
* **Literature Foundation**:
  * **Total Self-Sufficiency Failure**: A breakdown where the interface cannot stand on its own without out-of-band oral tradition.
  * **Nielsen Heuristic #10 (Help and Documentation)**: Absence of contextual, searchable, task-oriented guidance within the interface.
  * **Fogg's Social Deviance & Non-Routine Factors**: Forcing a user to interrupt a coworker imposes high social and organizational costs.

---

### 3. What Established Literature Has That Our 10 Types Lack
While our ten friction types capture the user's *felt emotional and physical symptoms*, the established literature highlights six critical structural categories that our current list does not explicitly capture:

```
+----------------------------------------------------------------------------------------------------+
|                                    ESTABLISHED LITERATURE GAPS                                     |
+------------------------------------+---------------------------------------------------------------+
| 1. Error Prevention & Recovery     | Nielsen #5 & #9; Baymard inline validation; Wroblewski        |
| 2. Cross-Screen Memory Load        | Sweller working memory limits; Cowan 2001; Nielsen #6         |
| 3. Consistency & Habit Violations  | Jakob's Law (Nielsen 2000); Nielsen #4 (Platform conventions) |
| 4. Accessibility & Situational Gap | ISO 9241-171; WCAG 2.2; Environmental field encumbrance       |
| 5. Trust, Reversibility & Control  | Nielsen #3; Shneiderman 1986 (8 Golden Rules); Auditability   |
| 6. Deliberate / Constructive Friction| Safety interlocks vs Thaler/Sunstein "Sludge"                 |
+------------------------------------+---------------------------------------------------------------+
```

#### Gap 1: Error Prevention and Recovery Mechanisms (Nielsen Heuristics #5 & #9)
* **What is missing**: Our ten types focus on what happens when a user gets confused. They do not isolate *design defects that trap users into making errors*, such as:
  * Lack of input constraints (allowing letters in a phone number field, then yelling at the user on submit).
  * Premature inline validation (Baymard found that validating an email while the user is still typing triggers immediate panic and false error flags).
  * Cryptic error messages that describe technical stack traces rather than how to fix the problem (violating Nielsen #9).
* **Recommended addition**: **Trap / Punish** (Interface permits an easily preventable error, or reports an error without offering a recovery path).

#### Gap 2: Cross-Screen Working Memory Load (Sweller 1988; Cowan 2001; Nielsen Heuristic #6)
* **What is missing**: Our "Strain" type covers general fatigue, but does not isolate **context loss across steps**.
* Human working memory holds only 3 to 4 items ("chunks") simultaneously (Cowan, 2001). When an enterprise wizard forces a worker to remember a vendor ID from step 1 to enter in step 4, it creates extreme cognitive vulnerability. Any interruption completely wipes the memory.
* **Recommended addition**: **Carry** (Interface forces the user to remember information across screens, tabs, or modal dialogs instead of passing it forward automatically).

#### Gap 3: Consistency with Platform Habits (Jakob's Law; Nielsen Heuristic #4)
* **What is missing**: Jakob Nielsen's Law of Internet User Experience (Nielsen, 2000) states: *"Users spend most of their time on other sites [and apps]. This means that users prefer your site to work the same way as all the other sites they already know."*
* When an enterprise app re-invents basic controls—such as using `Ctrl+S` to open a search bar instead of saving, or putting the "Confirm" button on the left while standard operating system guidelines put it on the right—it causes subconscious motor errors.
* **Recommended addition**: **Clash** (Interface violates established operating system, browser, or industry interaction conventions).

#### Gap 4: Accessibility and Situational Encumbrance (ISO 9241-171; WCAG 2.2)
* **What is missing**: Physical and sensory limitations. A screen may be usable in an air-conditioned office with a 27-inch monitor, but unusable on a phone in bright sunlight, or by an operator with mild tremor or color vision deficiency.
* **Recommended addition**: **Barred** (Physical or environmental barrier: insufficient color contrast, tiny tap targets under 48x48px, lack of keyboard navigation, or failure under bright light/vibration).

#### Gap 5: Trust, Agency, and Reversibility (Nielsen Heuristic #3; Shneiderman's 8 Golden Rules)
* **What is missing**: Ben Shneiderman's classic Golden Rule (Shneiderman, 1986): *"Support internal locus of control and permit easy reversal of actions."*
* Enterprise users experience deep anxiety when software feels like a "black box" where actions are irreversible or mysterious background processes occur without consent.
* **Recommended addition**: **Locked / Trapped** (Action cannot be undone, cancelled, or previewed before committing irreversible financial or customer changes).

#### Gap 6: Deliberate Friction (Constructive Speedbumps) vs. Bad Friction (Sludge)
* **What is missing**: **Not all friction is bad.**
* **Constructive Friction**: A deliberate speedbump introduced by design to force conscious deliberation before a dangerous, destructive, or costly action (e.g., requiring a user to type the word "DELETE" before wiping a customer database, or requiring dual authorization before releasing a $100,000 wire transfer).
* **Sludge (Thaler & Sunstein)**: Unjustified, burdensome friction that serves no user benefit and exists only due to bureaucracy or bad engineering.
* **Distinction rule**: Constructive friction protects the user from catastrophic errors; sludge wastes the user's life on bureaucratic mechanics.
* **Recommended taxonomy role**: Evaluators must mark whether a friction point is **Defective Friction** (must be removed) or **Deliberate Safety Friction** (must be preserved and polished).

---

## Section D. Severity Scale and How to Rank Findings

To prioritize fixes, friction cannot merely be described; it must be measured and ranked.

### 1. Nielsen's Classical Severity Rating Model (1995)
Jakob Nielsen established that usability problem severity is determined by combining specific factors:
1. **Frequency**: Is the problem common or rare? Does it hit every user on every visit, or only occasionally?
2. **Impact**: How easy or difficult is it for the user to overcome the obstacle?
3. **Persistence**: Is it a one-time hurdle that users learn once and never stumble on again, or does it repeatedly hinder them every time they use the system?
4. **Market Impact**: The broader business and sales consequences of the problem (e.g., whether the defect will damage product popularity, purchase decisions, or customer retention).

Nielsen's 0 to 4 Rating Scale (Cited Source):
* **0 = Not a usability problem**: Evaluator does not agree this is an issue.
* **1 = Cosmetic problem only**: Need not be fixed unless spare time is available.
* **2 = Minor usability problem**: Low priority fix; causes slight delay or minor annoyance.
* **3 = Major usability problem**: High priority fix; causes substantial delay, severe confusion, or frequent workarounds.
* **4 = Usability catastrophe**: Imperative to fix before release; causes complete task blockage, data loss, or unacceptable error.

### 2. Adaptation to Enterprise & Line-of-Business Reality
In consumer software, a Severity 2 (minor) issue might be ignored. In enterprise software, **frequency multiplies severity**. 

For example, as an illustration (not empirical data): a 3-second hesitation on an invoice line item processed 1,000 times daily represents 3,000 seconds (50 minutes) a day. Over a standard 20-working-day month, that equals 1,000 minutes—approximately 16.7 hours (about 17 hours) of lost working time per month for a single operator. Across ten operators, that single micro-hesitation consumes roughly 167 working hours each month.

Furthermore, enterprise severity must evaluate **Operational Risk**:
* Does the friction risk silent financial error?
* Does it risk regulatory compliance violation?
* Does it cause workers to bypass security policies?

### 3. Recommended Severity Scoring Matrix: Our Proposal (built on Nielsen 1995)
The ranking formula and composite matrix below represent **our proposal (built on Nielsen 1995)** to synthesize Nielsen's factors with enterprise operational risk:

$$\text{Severity Rank} = \text{Impact} \times \text{Persistence} \times \text{Frequency} \times \text{Operational Risk Multiplier}$$

| Severity Level | Name | User Impact | Operational Consequence | Action Required |
| :---: | :--- | :--- | :--- | :--- |
| **S1** | **Catastrophic Blocker** | • Task cannot be completed (**Stopped**).<br>• Irreversible data loss or severe data corruption.<br>• Silent failure of critical business logic. | System halted; severe financial, regulatory, or customer penalty. | **Blocker**: Must be fixed immediately. System cannot ship or pass review. |
| **S2** | **Major Operational Drag** | • User requires external intervention (**Ask Someone**).<br>• User forced to backtrack repeatedly or abandon automated flow for a manual spreadsheet.<br>• Severe cognitive strain and chronic hesitation. | Substantial increase in task duration; high error rate; worker burnout and shadow IT creation. | **High Priority**: Must be scheduled into the immediate current sprint. |
| **S3** | **Minor Friction / Paper Cut** | • User hesitates, hunts, or guesses, but eventually recovers alone.<br>• Redundant data entry; lack of keyboard accelerators.<br>• Delayed feedback (>1 second) causing uncertainty. | Measurable drag across high-frequency tasks; cumulative fatigue and diminished trust. | **Medium Priority**: Batch fix during dedicated polish sprints or component upgrades. |
| **S4** | **Cosmetic Inconsistency** | • Minor visual misalignment, slight styling flaw, or suboptimal wording that does not induce hesitation or errors. | Degrades perceived brand polish; no measurable loss of speed or accuracy. | **Low Priority**: Fix opportunistically when modifying adjacent code. |

---

## Section E. Walk Protocol for an Agent

When an AI agent evaluates software, it possesses significant biases: it has infinite patience, reads raw DOM trees without looking at visual layouts, never feels anxiety, and cannot feel physical finger fatigue. 

To conduct a valid role job walk that uncovers **what a human would feel**, an agent must follow a strict, disciplined protocol that constrains its artificial advantages.

```
+----------------------------------------------------------------------------------------------------+
|                                    AGENT ROLE-JOB WALK PROTOCOL                                    |
+----------------------------------------------------------------------------------------------------+
| Phase 1: Pre-Action Grounding   -> Write role, goal, and knowledge boundaries BEFORE looking at DOM|
| Phase 2: Visual-First Inspection-> Inspect only rendered screen, not hidden DOM or backend endpoints|
| Phase 3: The 4-Question Gate    -> Answer Wharton & Spencer questions explicitly at every step     |
| Phase 4: Quantitative Logging   -> Count steps, clicks, backtracks, lostness, and memory load      |
| Phase 5: Post-Task Assessment   -> Calculate Lostness (L) and assign Single Ease Question (SEQ)    |
+----------------------------------------------------------------------------------------------------+
```

### 1. Phase 1: Pre-Action Grounding (What to Write Before Acting)
Before loading the screen or executing any action, the agent must write out an explicit **Grounding Contract**:
1. **Role Persona**: Job title, experience level (e.g., "First-week warehouse inventory clerk"), and typical emotional state (e.g., "Rushed, carrying handheld scanner, wearing gloves").
2. **Prior Knowledge Boundaries**: What this persona knows and specifically does NOT know. (e.g., *"Knows part numbers; does NOT know database schema, internal microservice names, or URL routing structures."*)
3. **Explicit Job Goal**: The business outcome desired (e.g., *"Accept a pallet of 24 units of Part A-100 and record the storage bin location."*)
4. **Current Expectation**: Before looking at the new page, write what the user expects to see next based on the prior step.

### 2. Phase 2: What the Agent Must NOT Use
To prevent "omniscient evaluation," the agent is strictly forbidden from using:
* **Direct URL jumping**: Must not navigate directly to deep URLs unless a human worker has that link emailed to them.
* **Hidden DOM and Developer Tooling**: Must not inspect hidden input fields, internal HTML attributes (`data-test-id` or component names), or network payloads to guess what an ambiguous button does. It may only read text and visual signifiers that are visibly rendered on the screen.
* **Silent Guessing**: If the agent is unsure which button to click, it must NOT quietly try one and backtrack. It must log a **Guess** friction event, record why the label was ambiguous, and evaluate whether a human would have been stalled.
* **Infinite Speed**: The agent must not execute sequential clicks with zero latency. It must evaluate whether the interface provided feedback within the human perception window (0.1s to 1.0s).

### 3. Phase 3: The Per-Step Execution Gate (The Dual-Question Check)
At every single step in the workflow, the agent must log answers to Spencer's (2000) and Wharton's (1994) walkthrough questions:
1. *Will the user know what to do at this step?*
   * Is the required control visibly present on the screen without scrolling past the fold?
   * Does the label use plain business language rather than technical jargon?
   * If No: Log **Hunt**, **Hesitate**, or **Guess**.
2. *If the user does the right thing, will they know that they did it and that they are making progress?*
   * Did the screen acknowledge the click within 1.0 second?
   * Is the resulting state obvious and reassuring?
   * If No: Log **Wait or Wonder** or **Doubt**.

### 4. Phase 4: What to Measure and Count
The agent must objectively log metrics across the entire workflow:
* **Total Actions Taken ($S$)**: Total count of page visits, clicks, and state changes.
* **Optimal Actions ($R$)**: The minimum theoretically possible actions required to complete the job.
* **Unique Screens Visited ($N$)**: Distinct views encountered.
* **Smith's Lostness Metric ($L$)**:
  $$L = \sqrt{\left(\frac{N}{S} - 1\right)^2 + \left(\frac{R}{N} - 1\right)^2}$$
  * If $L < 0.4$: Navigation was efficient and direct.
  * If $L > 0.5$: Navigation exhibited severe disorientation, looping, and backtracking (**Backtrack**).
* **Redundant Data Inputs**: Count of fields where the user entered information the system already possessed (**Repeat**).
* **Feedback Latency**: Elapsed time between action trigger and visual confirmation (**Wait or Wonder**).

### 5. Honest Breakdown: What an Agent Cannot Perceive & The Proxy to Measure Instead
Because an AI agent is a software model running on silicon, it cannot experience biological sensations. An honest testing protocol requires mapping every human sensory/emotional blind spot to a rigorous, objective **proxy measurement**:

| Human Experience | Why the Agent Cannot Perceive It | Objective Proxy the Agent Must Measure Instead |
| :--- | :--- | :--- |
| **Visceral Frustration & Anger** | The agent has no nervous system, blood pressure, or emotions; it never feels rage when an app wipes its input. | **Rework & Lost Effort Metric**: Calculate the exact number of typed characters, form selections, or minutes of work destroyed when an error occurs or when a form resets. |
| **Anxiety & Fear of Making Mistakes** | The agent has no job on the line, cannot be fired, and does not face financial penalties for submitting incorrect data. | **Reversibility & Auditability Audit**: Check whether the action has an "Undo" mechanism, whether a confirmation dialog clearly summarizes the financial/data impact, and whether the system provides a safety preview before committing. |
| **Visual Glare & Sunlight Washing** | The agent parses pixel color arrays or CSS strings in memory; it has no optical retinas affected by ambient solar lux. | **Automated Contrast Ratio Calculation (WCAG 2.2)**: Calculate luminance contrast between text and background. For field workers in bright daylight, apply the strict 7:1 contrast threshold (WCAG Level AAA) rather than the standard 4.5:1 threshold (WCAG Level AA for normal text). |
| **Physical Finger Fatigue & Tremor** | The agent clicks exact coordinate centers $(x, y)$ mathematically without motor variability or muscle exhaustion. | **Fitts's Index of Difficulty ($ID$) & Touch Target Geometry**: Measure the physical target size in pixels/millimeters. Flag any primary interactive element under $48 \times 48$ CSS pixels (or less than 9mm physical on mobile screens) or with spacing under 8px to adjacent targets. |
| **Field Encumbrance (Gloves / Walking)** | The agent does not walk across uneven gravel, hold heavy tools, or operate a device with thick insulated gloves. | **Multi-Touch & Precision Gesture Audit**: Flag any requirement for pinch-to-zoom, delicate drag-and-drop, tiny dropdown arrows, or multi-finger gestures. Flag any workflow requiring two hands when a field role requires one hand free for safety. |
| **Divided Attention & Interruptions** | The agent processes a prompt with 100% focused compute; it is never interrupted by a forklift horn, a client phone call, or a coworker asking a question. | **Cross-Screen Memory & Session State Audit**: Count the number of discrete data items the user must retain across steps (Cowan 2001 limit: 4 chunks). Measure whether the application preserves draft state if the browser is closed or inactive for 15 minutes. |

---

## Section F. Open Questions and Thin Evidence

To maintain rigorous research integrity, we must plainly state where the literature is conclusive and where empirical evidence is currently thin:

### 1. Where Evidence is Strong & Conclusive
* **Interaction Cost and Cognitive Load**: Decades of laboratory and eye-tracking research (Sweller, Nielsen, Budiu, Baymard) conclusively show that extraneous visual clutter, dense multi-column forms, ambiguous icons, and missing feedback dramatically increase error rates and task completion times.
* **The Mathematical Model of Problem Discovery**: Nielsen & Landauer's (1993) formula ($N(1 - (1 - L)^n)$) has been verified across hundreds of commercial studies: running small usability tests with 5 representative users repeatedly catches approximately 85% of usability defects, outperforming large single-batch tests.
* **Lostness and Task Performance**: Smith's (1996) Lostness metric reliably predicts disorientation in information architectures.

### 2. Where Evidence is Thin or Emerging
* **AI Agents as Stand-Ins for Human Usability Testers**:
  * While recent frameworks like *UXAgent* (Lu et al., CHI 2025 / arXiv:2502.12561) demonstrate that LLM agents can successfully execute browser tasks and flag surface-level heuristic violations, **peer-reviewed evidence that AI agents can reliably predict human emotional friction is thin**.
  * Current research indicates that LLM agents suffer from two severe evaluation flaws:
    1. **False Positives (Hallucinated Usability Flaws)**: LLMs frequently hallucinate usability problems that real human beings easily bypass using common sense.
    2. **Contextual Blindness**: LLMs consistently miss subtle domain-specific friction, such as whether a specialized accounting term feels natural to a certified public accountant.
* **Quantitative Scaling of Friction in Enterprise Workflows**:
  * While the Single Ease Question (SEQ) and SUS are standardized for standalone tasks, there is limited peer-reviewed research on **cumulative friction compounding** across an eight-hour enterprise shift. Most HCI metrics measure isolated task usability rather than continuous occupational software fatigue.
* **Optimal Calibration of Constructive Friction**:
  * While behavioral economics (Thaler & Sunstein) distinguishes between sludge and legitimate screening hurdles, there are no established, formulaic standards for exactly how much friction should be inserted to prevent catastrophic business errors without unnecessarily slowing down expert operators.

---

## Sources

Every source below is a primary authority (the author's own book, paper, official organization page, or design standard) or explicitly marked as a secondary account. Each is explicitly marked as **opened** (verified directly during research) or **not opened** (with the exact primary citation noted).

1. **Nielsen, Jakob (1994)**. "10 Usability Heuristics for User Interface Design." Nielsen Norman Group.  
   `https://www.nngroup.com/articles/ten-usability-heuristics/` — **opened**
2. **Nielsen, Jakob (1995)**. "Severity Ratings for Usability Problems." Nielsen Norman Group.  
   `https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/` — **opened**
3. **Budiu, Raluca (2013)**. "Interaction Cost: Definition." Nielsen Norman Group.  
   `https://www.nngroup.com/articles/interaction-cost-definition/` — **opened**
4. **Whitenton, Kathryn (2013)**. "Minimize Cognitive Load to Maximize Usability." Nielsen Norman Group.  
   `https://www.nngroup.com/articles/minimize-cognitive-load/` — **opened**
5. **Nielsen, Jakob (2000)**. "Why You Only Need to Test with 5 Users." Nielsen Norman Group.  
   `https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/` — **opened**
6. **Nielsen, Jakob (2012)**. "Thinking Aloud: The #1 Usability Tool." Nielsen Norman Group.  
   `https://www.nngroup.com/articles/thinking-aloud-the-1-usability-tool/` — **opened**
7. **Budiu, Raluca (2018)**. "Beyond Blue Links: Making Clickable Elements Recognizable." Nielsen Norman Group.  
   `https://www.nngroup.com/articles/clickable-elements/` — **opened**
8. **Baymard Institute (2023)**. "Checkout Optimization: Minimize Form Fields." Baymard Institute UX Research.  
   `https://baymard.com/blog/checkout-flow-average-form-fields` — **opened**
9. **GOV.UK Design System (2024)**. "Question pages." Government Digital Service, UK.  
   `https://design-system.service.gov.uk/patterns/question-pages/` — **opened**
10. **Wroblewski, Luke (2008)**. "Web Form Design: Filling in the Blanks." Rosenfeld Media / LukeW.  
    `https://www.lukew.com/resources/web_form_design.asp` — **opened**
11. **Fogg, B.J. (2009)**. "Fogg Behavior Model." Stanford Persuasive Technology Lab / Behavior Design Lab.  
    `https://behaviormodel.org/` — **opened**
12. **Bifulco, Mike (2022)**. "How Stripe Uses Friction Logs to Improve their Products." Personal website of former Stripe DevRel engineer (secondary account; personal blog post by former employee, not official Stripe corporate publication).  
    `https://mikebifulco.com/posts/how-stripe-uses-friction-logs` — **opened (secondary source)**
13. **Sauro, Jeff (2010)**. "10 Things To Know About The Single Ease Question (SEQ)." MeasuringU.  
    `https://measuringu.com/seq10/` — **opened**
14. **Lu, Yuxuan, Yao, Bingsheng, Gu, Hansu, et al. (2025)**. "UXAgent: An LLM Agent-Based Usability Testing Framework for Web Design." arXiv preprint arXiv:2502.12561 [cs.HC] / ACM CHI 2025 Extended Abstracts.  
    `https://arxiv.org/abs/2502.12561` — **opened**
15. **Shneiderman, Ben (1986 / updated)**. "The Eight Golden Rules of Interface Design." Department of Computer Science, University of Maryland.  
    `https://www.cs.umd.edu/users/ben/goldenrules.html` — **opened**
16. **Nielsen, Jakob (2000 / 2017)**. "Jakob's Law of Internet User Experience." Nielsen Norman Group.  
    `https://www.nngroup.com/videos/jakobs-law-internet-user-experience/` — **opened**
17. **World Wide Web Consortium (W3C) (2023)**. "Web Content Accessibility Guidelines (WCAG) 2.2." W3C Recommendation 05 October 2023.  
    `https://www.w3.org/TR/WCAG22/` — **opened**
18. **Norman, Don (2013)**. *The Design of Everyday Things: Revised and Expanded Edition*. Basic Books.  
    Author's website overview: `https://jnd.org/signifiers_not_affordances/` — **not opened (HTTP 429 rate-limited; cited from Norman 2013 book, Chapter 1 & ACM Interactions 2008)**
19. **Wharton, Cathleen, Rieman, John, Lewis, Clayton, & Polson, Peter (1994)**. "The cognitive walkthrough method: A practitioner's guide." In J. Nielsen & R. L. Mack (Eds.), *Usability Inspection Methods* (pp. 105–140). John Wiley & Sons.  
    `https://dl.acm.org/doi/10.5555/189200.189205` — **not opened (paywalled; cited from Wharton et al. 1994 and University of Colorado Technical Report CU-CS-647-93)**
20. **Spencer, Rick (2000)**. "The streamlined cognitive walkthrough method, working around social constraints encountered in a software development company." In *Proceedings of the SIGCHI Conference on Human Factors in Computing Systems* (CHI '00), pp. 353–359.  
    `https://dl.acm.org/doi/10.1145/332040.332456` — **not opened (paywalled; cited from ACM Digital Library record and Spencer CHI 2000 proceedings)**
21. **Sweller, John (1988)**. "Cognitive load during problem solving: Effects on learning." *Cognitive Science*, 12(2), 257–285.  
    `https://onlinelibrary.wiley.com/doi/abs/10.1207/s15516709cog1202_4` — **not opened (paywalled; cited from Cognitive Science journal record and Sweller 1988)**
22. **Cowan, Nelson (2001)**. "The magical number 4 in short-term memory: A reconsideration of mental storage capacity." *Behavioral and Brain Sciences*, 24(1), 87–114.  
    `https://doi.org/10.1017/S0140525X01003922` — **not opened (paywalled; cited from Cambridge Core journal record)**
23. **Nielsen, Jakob, & Landauer, Thomas K. (1993)**. "A mathematical model of the finding of usability problems." In *Proceedings of the INTERACT '93 and CHI '93 Conference on Human Factors in Computing Systems*, pp. 206–213.  
    `https://dl.acm.org/doi/10.1145/169059.169166` — **not opened (paywalled; cited from ACM Digital Library record)**
24. **Smith, Pauline A. (1996)**. "Towards a practical measure of hypertext usability." *Interacting with Computers*, 8(4), 365–381.  
    `https://www.sciencedirect.com/science/article/abs/pii/S0953543897837794` — **not opened (paywalled; cited from Elsevier ScienceDirect record and Smith 1996)**
25. **Brooke, John (1996)**. "SUS: A 'quick and dirty' usability scale." In P. W. Jordan, B. Thomas, B. A. Weerdmeester, & A. L. McClelland (Eds.), *Usability Evaluation in Industry* (pp. 189–194). Taylor & Francis.  
    `https://www.taylorfrancis.com/chapters/edit/10.1201/9781498710411-35/sus-quick-dirty-usability-scale-john-brooke` — **not opened (paywalled; cited from Brooke 1996 in Usability Evaluation in Industry)**
26. **Sauro, Jeff, & Dumas, Joseph S. (2009)**. "Comparison of three one-question post-task usability questionnaires." In *Proceedings of the SIGCHI Conference on Human Factors in Computing Systems* (CHI '09), pp. 1599–1608.  
    `https://dl.acm.org/doi/10.1145/1518701.1518946` — **not opened (paywalled; cited from ACM Digital Library record)**
27. **International Organization for Standardization (2018)**. "ISO 9241-11:2018 Ergonomics of human-system interaction — Part 11: Usability: Definitions and concepts."  
    `https://www.iso.org/standard/63500.html` — **not opened (paywalled standard; cited from ISO catalog record and ISO 9241-11:2018 definition text)**
28. **International Organization for Standardization (2008)**. "ISO 9241-171:2008 Ergonomics of human-system interaction — Part 171: Guidance on software accessibility."  
    `https://www.iso.org/standard/39080.html` — **not opened (paywalled standard; cited from ISO catalog record)**
29. **Thaler, Richard H. (2018)**. "Nudge, not sludge." *Science*, 361(6401), 431.  
    `https://www.science.org/doi/10.1126/science.aau9241` — **not opened (paywalled; cited from Science journal record and Thaler 2018)**
30. **Sunstein, Cass R. (2019)**. "Sludge and ordeals." *Behavioural Public Policy*, pp. 1–17.  
    `https://www.cambridge.org/core/journals/behavioural-public-policy/article/sludge-and-ordeals/03C0D08A46B70591DAEDF986A80EC216` — **not opened (paywalled; cited from Cambridge Core record)**
31. **Hick, William E. (1952)**. "On the rate of gain of information." *Quarterly Journal of Experimental Psychology*, 4(1), 11–26.  
    `https://doi.org/10.1080/17470215208416600` — **not opened (paywalled; cited from Experimental Psychology Society record)**
32. **Fitts, Paul M. (1954)**. "The information capacity of the human motor system in predicting the amplitude of movement." *Journal of Experimental Psychology*, 47(6), 381–391.  
    `https://doi.org/10.1037/h0055301` — **not opened (paywalled; cited from APA PsycNet record)**
