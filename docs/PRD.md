# RouteLab: Product Requirements Document

Version 1.0 for app version 1.0.0. Companion documents: [SPEC.md](SPEC.md) (clean-room build spec, normative) and [MODEL.md](MODEL.md) (modelling assumptions, formulas, parameter sources and limitations).

## 1. Summary

RouteLab is a browser-only simulator that shows how payment-routing strategies change the success rate (SR), cost and customer experience of a merchant's UPI, card and netbanking traffic. It generates synthetic traffic from a seed, sends the same traffic through several routing strategies (static priority, weighted split, rules, epsilon-greedy and Thompson-sampling bandits, and a cost-aware bandit), and compares them against an oracle that knows each fictional gateway's true current success rate. Results are averaged over many seeds with 95% confidence intervals, so a reader sees robust effects, not one lucky run.

It ships as a static page (GitHub Pages or double-click offline), a small JavaScript library that also runs in Node, and a command-line tool. Every gateway, bank and number is synthetic. Defaults are illustrative and labelled as such. RouteLab demonstrates mechanisms and trade-offs; it does not predict real-world success rates and is not financial advice.

## 2. Problem

Payment success rate is the headline metric for checkout, and routing (which gateway or processor handles each payment) is one of the main levers. Building intuition for routing is hard without production access:

- Public material explains the ideas (rules, volume splits, "intelligent" success-rate routing) but rarely lets you see them interact with outages, cost differences, retries and customer drop-off.
- Learning routers are usually described as multi-armed bandits. The non-stationary part (gateways degrade and recover, so the router must keep exploring and forget old data) is where most of the practical trade-offs sit, and it is the part least often shown.
- Simple comparisons mislead. A single simulated day can make any strategy look best by chance. Fair comparisons need the same traffic for every strategy (paired), many seeds and intervals.

## 3. Target users

| User | Need |
|---|---|
| Aspiring and junior payments or fintech product managers | Intuition for SR, retries, cost per success and learning routers, with a vocabulary they can use in interviews and reviews |
| Students of payments, operations research or reinforcement learning | A concrete, honest example of a non-stationary bandit with a clear oracle and regret |
| Early-stage merchant product folks | A way to reason about "should we add a second gateway?" and "what does a smart router buy us?" before talking to vendors |
| Engineers evaluating open-source routing engines | A neutral explainer of the strategy families and their failure modes |

## 4. Jobs to be done

1. "Show me what happens to SR when my best gateway goes down at the evening peak, for each routing approach."
2. "Help me see the price of exploration: how much does a learning router lose when nothing is going wrong?"
3. "Let me trade SR against cost and see where each strategy sits."
4. "Give me a short, honest memo I can paste into a doc, with intervals and caveats."
5. "Let me share exactly this setup with a colleague via a link."
6. "Let me run the same thing from Node or a script, reproducibly."

## 5. Competitors and differentiation

Public alternatives (described from their public documentation; details to be re-checked before citing in the README, see SPEC section 18):

- Open-source payment orchestrators such as Hyperswitch (by Juspay) document rule-based routing, volume-split routing and success-rate-based routing. Juspay has also published an open-source decision engine for success-rate-based gateway selection and has described routing publicly as a non-stationary multi-armed bandit problem. These are production systems, not teaching tools: they need integration, real gateways and real traffic.
- General bandit libraries and textbook notebooks (for example Thompson-sampling tutorials) show the algorithms on toy Bernoulli arms, without payments concepts such as retries on another gateway, per-method success rates, fees, issuer outages or customer drop-off.
- Vendor blog posts and case studies describe outcomes, usually without reproducible setups.

RouteLab's position: a reproducible, inspectable teaching simulator. Same traffic for every strategy, many seeds with confidence intervals, an oracle and regret, explicit and labelled assumptions, documented expected outcomes checked by tests, and no installation.

## 6. Goals and non-goals

Goals:

- G1. Correct, reproducible simulation: the same configuration and seeds always give byte-identical results.
- G2. Fair comparisons: all strategies see identical traffic and common random numbers; differences are reported as paired differences with intervals.
- G3. Honest modelling: every assumption is written down (MODEL.md), every default is either sourced or labelled "illustrative", and limitations are stated in the app, README and memo.
- G4. Teaching value: seven scenario presets, each with a documented expected qualitative outcome, summarised in 7.4; SPEC section 6.4 lists exactly what the test suite asserts on seed-averaged results, on two disjoint seed sets.
- G5. Zero friction: static page, offline, no account, no network, no analytics.

Non-goals (v1):

- Predicting any real merchant's or gateway's success rate, or recommending a real vendor.
- Modelling real companies. Gateways are "Gateway A" to "Gateway E" and banks are "Bank X", "Bank Y", "Bank Z", and names cannot be edited.
- Contextual bandits over issuer bank, BIN, device or amount (learning routers learn per payment method only).
- Pending or unknown payment states, refunds, chargebacks, settlement, reconciliation, fraud and risk declines.
- Multi-day seasonality, weekly patterns, festive spikes (capacity limits are configurable but no festive preset ships).
- Web Workers (they do not start from file:// in Chromium-based browsers), server components, accounts or saved profiles.

## 7. MVP scope

### 7.1 Model (detail in MODEL.md, normative in SPEC section 3)

- 2 to 5 fictional gateways, each with per-method technical success rate, lognormal latency (p50, p95), fees (fixed rupees plus percent of amount, charged on success), optional capacity (attempts per minute) and an active-from time (for cold start).
- Payment methods: UPI intent, UPI collect, cards, netbanking.
- Customer-side ("business") declines per method, drawn once per transaction, never retried and never blamed on the gateway; technical declines per attempt, retryable.
- Three fictional issuer or remitter banks with shares and success factors.
- Events on a gateway or a bank: start, duration, SR factor, latency factor, linear recovery, optional repetition (for flapping).
- Traffic: 24 hourly weights (default has an evening peak), transactions per day, method mix, amount distribution per method, bank mix.
- Retries: up to 3, on another gateway (default) or the same one; a retry delay; an illustrative drop-off model where the chance that the customer gives up before a retry grows with waiting time.
- A discrete-event engine in simulated time, so routers learn only from outcomes that have completed.

### 7.2 Strategies (SPEC section 4)

1. Static priority (ordered gateway list).
2. Weighted split (percentages).
3. Rule-based (method and amount rules with fallback to the priority list).
4. Epsilon-greedy with a sliding time window.
5. Thompson sampling (Beta-Bernoulli) with time-based discounting (half-life).
6. Cost-aware Thompson sampling: maximise sampled SR minus lambda times fee.

Plus an oracle reference that always picks the gateway with the highest true current technical SR. Each learning strategy's memory can be switched between none, sliding window and discounting.

### 7.3 Metrics (SPEC section 3.7 and 5)

Order SR (with retries), first-attempt SR, attempt SR, cost per successful transaction, effective fee rate, time to success p50 and p95, retries per transaction, drop-off rate, final-status breakdown (synthetic taxonomy: customer decline, technical decline, rate limited, no route), routable regret per 1,000 transactions against the oracle. Each as mean with a 95% t-interval across seeds; paired differences against a chosen baseline; time series in 15-minute buckets; focus-window metrics for the scenario's event.

### 7.4 Scenarios (SPEC section 6)

| Id | Title | Expected qualitative outcome |
|---|---|---|
| `steady` | Steady state | Static priority on the best (and cheapest) gateway equals the oracle; Thompson sampling pays a small exploration cost in first-attempt SR, cost per success and regret, while its order SR stays within one point |
| `peak-outage` | Evening-peak outage on the best gateway | Thompson sampling moves first attempts away from the failing gateway within 15 minutes; Thompson sampling and epsilon-greedy both keep order SR much higher than static during the outage hour |
| `collect-degradation` | UPI collect degradation on one gateway | Per-method learning (Thompson sampling) lifts collect order SR well above static without hurting intent; the rule that already sends collect elsewhere does too |
| `cost-vs-sr` | Cheap-but-flaky vs expensive-but-reliable | SR-only bandit: highest SR and cost; cheapest-first static: lowest of both; cost-aware bandit in between |
| `cold-start` | New, better gateway joins at noon | Thompson sampling discovers it and shifts most first attempts to it; epsilon-greedy with a 30-minute window shifts clearly less; static configurations ignore it until someone edits them |
| `flapping` | Flapping gateway | Learning routers beat static, but repeated outages make them pay repeated detection and re-exploration costs |
| `issuer-outage` | Issuer bank outage (not routable) | Static priority and Thompson sampling both lose more than 10 points of order SR during the outage hour; static still equals the oracle and Thompson sampling does no better, because routing cannot fix an issuer-side outage |

The seventh scenario was added to the brief's six because it teaches the most important limit of routing.

### 7.5 Web page (SPEC section 8)

- Tabs: Help (opens first on the first visit), Scenarios, Configure, Results.
- Scenario picker with the story and expected outcome of each preset; one click to load and run.
- Configurators for run, traffic, gateways, events, retries and drop-off, and strategies; field-level validation messages.
- Results: run summary; whether each documented expectation held on these seeds; three inline-SVG charts (SR over time per strategy with a method filter, gateway traffic share over time for a chosen strategy, cost vs SR scatter with interval whiskers), each with a data-table alternative; an hourly table of gateway attempt success rates for the chosen strategy (SR by gateway over time); a summary table with intervals; paired differences against the baseline; final-status breakdown.
- Exports: CSV (summary), JSON (full results), Markdown routing decision memo (download and copy).
- Shareable state in the URL hash; restoring a link runs it.
- Glossary in Help: SR (order vs attempt), MDR, intent vs collect, issuer, acquirer, PSP, gateway, business vs technical decline, bandit, exploration, Thompson sampling, discounting, sliding window, oracle, regret, confidence interval, paired comparison.

### 7.6 Library and CLI (SPEC section 7)

- `require('./js/routelab.js')` in Node, `window.RouteLab` in the browser: `simulate`, `createRunner`, `validateConfig`, `getScenario`, `scenarios`, `buildMemo`, `toCsv`, `toJson` (results include the expectation checks when a preset is run).
- `node scripts/simulate.cjs --scenario <id> --seeds N` prints the summary, paired differences and expectation checks; other options: `--format text|json|csv|memo`, `--out <file>`, `--config <file.json>`, `--seed-start S`, `--txns N`, `--assert`, `--list`, `--help` (SPEC section 7.4 is normative).

### 7.7 Documents

README (public, exhaustive), PRD, SPEC, MODEL, RESULTS (generated from the fixed seed set), CASE-STUDY (placeholders only), LICENSE (MIT).

## 8. User flows

### Flow A: first visit

Open the page -> Help explains what RouteLab is, how to read results, and that everything is synthetic -> "Start with a scenario" opens Scenarios -> pick "Evening-peak outage" -> "Load and run" -> Results show SR over time with the outage window shaded and the learning lines staying up.

### Flow B: explore a trade-off

Scenarios -> "Cheap-but-flaky vs expensive-but-reliable" -> run -> look at the scatter -> Configure -> change the cost-aware lambda -> run -> see the point move along the trade-off.

### Flow C: share and export

After a run, copy the page address (the hash holds the configuration) -> a colleague opens it, the same run reproduces -> download the memo and paste it into a document.

### Flow D: developer

`node scripts/simulate.cjs --scenario flapping --seeds 30 --format json --out out.json`, or require the library and call `simulate(config, { seeds: 30 })`.

## 9. Success metrics (honestly measurable)

The app has no analytics by design. Only these are measured, and only after publishing:

| Metric | Source |
|---|---|
| GitHub stars, forks, watchers | Repository page |
| Unique visitors and views (14-day window) | GitHub repository traffic insights (owner only) |
| Issues and discussions opened by people other than the owner | Repository |
| Qualitative feedback from practitioners | Named only with their permission |

Quality metrics measured before launch: unit tests pass; RESULTS reproducible (identical hash on two generations); every scenario expectation holds on the fixed seed set and on a second, disjoint robustness seed set; performance budget (SPEC section 9) met or reported as missed; browser smoke passes three consecutive times in Edge and Firefox, file and http modes.

No usage numbers appear in the README or CASE-STUDY until they are real; CASE-STUDY uses placeholders.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Readers take simulated SRs as real-world predictions | "Synthetic, illustrative, not a forecast" on every results view, in the memo, README and MODEL; no real company names as entities |
| Cherry-picked seeds | Fixed seed sets defined in the SPEC before any measurement; expectations asserted on two disjoint sets; intervals everywhere |
| Expectations tuned to fit results | Thresholds fixed in the SPEC before implementation; changing one needs a recorded reason in the build report |
| Model too simple to be credible | Business vs technical declines, issuer outages, completion-time feedback, retries with drop-off and capacity; limitations listed explicitly |
| Over-complex UI | Scenarios first; configuration grouped in fieldsets; defaults that tell a story |
| Slow runs in the browser | Budget fixed in advance; chunked runner yields to the browser; per-seed traffic reuse |
| Clean-room breach | Deny-list and brand self-scan at packaging; synthetic names only |

## 11. Launch plan

1. Build, test and package (SPEC milestones).
2. Owner's open-source approval.
3. Publish to a public repository with GitHub Pages; release v1.0.0 with the zip.
4. Share with payments and product communities with the honest framing ("a teaching simulator on synthetic data").
5. 30-day review in CASE-STUDY with real numbers only.

## 12. Assumptions

- A. The learning routers' default hyperparameters (epsilon 0.10, window 30 minutes, half-life 20 minutes, lambda 0.01 per rupee) are reasonable teaching defaults, not tuned optima. The same defaults are used in every scenario so that no scenario is tuned to flatter a strategy.
- B. One simulated day at 10,000 transactions with 20 seeds is enough for stable comparisons on the shipped scenarios (checked by the robustness seed set).
- C. Learning per payment method (not per bank) is enough to show the main lessons; contextual learning is listed as a limitation.
- D. Users accept fixed gateway and bank names, which keeps screenshots and shared links free of real company names.
- E. Default technical failure rates are deliberately larger than public UPI ecosystem technical-decline figures, so that routing differences are visible within one simulated day. MODEL.md section 4.1 and the README say so; the gaps between gateways are illustrative, not typical.
