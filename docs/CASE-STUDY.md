# RouteLab case study (template)

Fill only with real, checked numbers; delete any clause you can't support. Every `[[placeholder]]` must be replaced or removed before this page is shared.

## One-line summary

RouteLab is a browser-only simulator that compares payment-routing strategies, from static priority to Thompson-sampling bandits, on synthetic UPI, card and netbanking traffic. [[one sentence on why you built it]]

## Links

- Live demo: [[live demo address]]
- Repository: [[repository address]]
- Release date: [[YYYY-MM-DD]]

## The problem

A merchant connected to several payment gateways has to pick one for every payment. Success rates, speed and fees differ between gateways and change during the day, so a fixed rule leaves money on the table during outages and degradations, while a learning router pays for its exploration when nothing changes. Product and engineering teams need a way to reason about that trade-off without production data. [[the context in which you met this problem, in your own words]]

## What I built

- A static page (no server, nothing uploaded) with Help, Scenarios, Configure and Results tabs, charts with data-table alternatives, shareable links and a downloadable decision memo.
- A Node.js library and a command-line tool that use the same simulation code.
- Seven preset scenarios, each with documented expectations that the test suite checks.
- [[anything else you added]]

## Key decisions and trade-offs

- **Discrete-event engine with completion-time feedback.** Routers decide when an attempt starts and learn when it completes, so they never see the future and slow methods give slow feedback.
- **Common random numbers and paired intervals.** Every strategy sees the same transactions and the same per-attempt random numbers; comparisons are paired by seed.
- **Per-method learning.** Learning routers keep estimates per payment method and gateway; per-bank context is a stated limitation, shown by the issuer-outage scenario.
- **Discounting vs window.** Thompson sampling forgets with a half-life, epsilon-greedy with a sliding window; both are configurable.
- **Cost-aware scoring.** A sampled success probability minus lambda times the fee makes the cost against success-rate trade-off explicit.
- **Fixed synthetic names.** Gateway A-E and Bank X-Z cannot be renamed, so links and screenshots never describe real companies.
- **Browser-only.** Classic scripts and main-thread time slices, so the page also works offline from a double-click.

## How I validated it

- Expectations and their thresholds were fixed in the design document before any run on the result seeds.
- Two disjoint seed sets (101-130 for the published results, 1-20 for the defaults) must both pass every expectation.
- A design-phase prototype on separate pilot seeds was used as a conformance reference for 84 values.
- The results files are reproducible: two generations give the same SHA-256, and a check mode compares them with the committed files.
- Browser smoke tests in two browsers, from the file system and over a local server.

## What I measured after launch

| Metric | Day 30 | Day 90 |
|---|---|---|
| Repository stars | [[n]] | [[n]] |
| Forks | [[n]] | [[n]] |
| Unique visitors to the demo (if measured outside the page) | [[n]] | [[n]] |
| Issues or questions opened by others | [[n]] | [[n]] |
| Conversations where it was used (interviews, talks, reviews) | [[n]] | [[n]] |

## What I learned

- [[lesson 1]]
- [[lesson 2]]
- [[lesson 3]]

## What's next

- [[next step 1]]
- [[next step 2]]

## Resume line

Built RouteLab, a browser-only payment-routing simulator comparing static, rule-based and bandit routers on synthetic UPI and card traffic with outages, retries, fees and paired confidence intervals; [[result you can support with a real, checked number, or delete this clause]].

Fill only with real, checked numbers; delete any clause you can't support.
