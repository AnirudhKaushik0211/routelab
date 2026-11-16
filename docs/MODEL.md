# RouteLab: simulation model, assumptions and limitations

Version 1.0 for app version 1.0.0. This document explains what RouteLab simulates, the formulas it uses, where each default comes from and what the model leaves out. The normative definitions (exact draw order, data structures, edge cases) are in [SPEC.md](SPEC.md) sections 3 to 6; where this document and the SPEC differ, the SPEC wins and the difference is a documentation bug.

**Read this first.** RouteLab is a teaching simulator. All gateways, banks, merchants and transactions are synthetic. Every numeric default is an **illustrative assumption** unless the "Source" column of section 9 says otherwise, and even sourced items are used only for orders of magnitude or for the structure of the model, never as real performance figures of any company. Results show how strategies behave **under these assumptions**. They do not predict real-world success rates. Nothing here is financial, legal or regulatory advice.

## 1. What is simulated

One merchant's payment traffic over one simulated day (00:00 to 24:00, in minutes). Each transaction (a customer trying to pay for one order) arrives at a time, has a payment method, an amount and an issuer or remitter bank, and is either paid, failed or abandoned. A routing strategy picks a gateway for each attempt. Failed attempts can be retried, possibly on another gateway, but the customer may give up while waiting.

Every strategy runs in its own copy of the world on **exactly the same transactions and the same random numbers** (common random numbers). Differences between strategies therefore come from their decisions, not from different luck. Each strategy also faces its own gateways: capacity used by one strategy does not affect another (each run is a counterfactual world, unlike a live A/B test, see section 10).

## 2. Entities

| Entity | Fields | Notes |
|---|---|---|
| Payment method | `upi_intent`, `upi_collect`, `card`, `netbanking` | Fixed set |
| Gateway | `A` to `E` (2 to 5), shown as "Gateway A" etc.; per method: technical SR, latency p50 and p95, fixed fee (Rs) and percent fee, or "not supported"; capacity (attempts per minute, optional); active from (minute) | Names are fixed so no real company can be named |
| Bank | `X`, `Y`, `Z` ("Bank X" etc.): share of traffic, SR factor | The customer's issuer (cards) or remitter bank (UPI, netbanking) |
| Event | target gateway or bank; methods (or all); start; duration; SR factor; latency factor; recovery minutes; repeat every; repeat count | Outages, degradations, flapping |
| Transaction | arrival time, method, amount, bank, customer-decline flag, pre-drawn random numbers for up to 4 attempts | Shared by all strategies |

## 3. Traffic

**Arrivals.** For minute `m` (0 to 1439) in hour `h = floor(m / 60)`, the arrival count is Poisson with mean

```
lambda_m = txnPerDay * w_h / (60 * sum_k w_k)
```

where `w_0 .. w_23` are the hourly weights. Arrival times are spread uniformly within the minute. The total per day is random around `txnPerDay` (Poisson), so two seeds have slightly different volumes; every strategy within a seed sees the same volume.

Default weights (illustrative; a weekday shape with a lunch bump and an evening peak, peak at 20:00 to 21:00):

```
00-05: 0.25 0.15 0.10 0.10 0.10 0.15
06-11: 0.30 0.55 0.80 1.00 1.10 1.15
12-17: 1.25 1.20 1.10 1.05 1.05 1.15
18-23: 1.40 1.80 2.00 1.90 1.40 0.70      (sum 21.75)
```

At the default 10,000 transactions per day the peak rate is about 15.3 per minute.

**Method mix** (illustrative): UPI intent 55%, UPI collect 10%, cards 25%, netbanking 10%. UPI's large share of Indian retail digital payments by volume is publicly documented by NPCI and RBI (section 11, [S1], [S2]); the exact split is an assumption.

**Amounts.** Lognormal per method, parameterised by median and 95th percentile and clipped to Rs 1 to Rs 2,00,000 (illustrative): UPI intent 300 / 3,000; UPI collect 500 / 5,000; card 1,500 / 10,000; netbanking 2,000 / 15,000 (rupees, p50 / p95). For a lognormal with median `M` and 95th percentile `P`:

```
mu = ln(M),  sigma = (ln(P) - ln(M)) / 1.6448536269514722
```

(1.6449 is the standard normal 95th percentile.) The heavy right tail matters for percent fees: large card payments carry most of the fee value.

**Banks** (illustrative): Bank X 40%, Bank Y 35%, Bank Z 25%, SR factor 1.0 each unless an event applies.

## 4. Attempt outcome

### 4.1 Two kinds of decline

Public UPI ecosystem statistics separate **business declines** (customer-side: wrong PIN, insufficient funds, request not approved, limits) from **technical declines** (bank, PSP or network side) [S3]. RouteLab follows that structure:

- **Customer-side decline.** With probability `d_method`, a transaction is "customer-declined". This is drawn once per transaction, so every gateway would decline it. The router sees the decline code, so: it is never retried, and learning routers do not count it against the gateway. Defaults (illustrative): UPI intent 0.05, UPI collect 0.18 (collect requests often expire unapproved), card 0.07, netbanking 0.10.
- **Technical outcome.** Otherwise each attempt on gateway `g` at time `t` succeeds with probability

```
p = clamp01( q_{g,m}(t) * b_{bank}(t) )
q_{g,m}(t) = sr_{g,m} * prod_events E_e(t)          (gateway events matching g and m)
b_{bank}(t) = srFactor_bank * prod_events E_e(t)   (bank events matching the bank and m)
```

where `sr_{g,m}` is the configured technical SR. Technical failures are retryable.

**The technical failure rates are deliberately exaggerated.** Public UPI ecosystem statistics [S3] report technical-decline rates for most large remitter banks that are much lower than RouteLab's defaults, and a public payments-industry article puts the overall UPI technical-decline rate at about 0.8% [S7] (to be confirmed before citing, SPEC section 18). RouteLab's gateway-level technical failure rates (1% to 15% depending on scenario, gateway and method; 3% to 8% for UPI intent on the base gateways) are deliberately larger. They also stand in for PSP-, app- and network-side failures that bank-level statistics do not attribute to banks. The reason is visibility: with ecosystem-level failure rates, the differences between routing strategies would be a fraction of a percentage point and would need many simulated days to show. Treat the gaps between gateways as illustrative, not typical; the mechanisms (who gains, who loses, and why) are the point, not the sizes.

So for a transaction that is not customer-declined, the first-attempt success probability is `q * b`; the overall first-attempt SR of a gateway is about `(1 - d) * q * b`. The configuration asks for `q` ("technical success rate") because that is what routing can change.

### 4.2 Events

An event occurrence with start `s`, duration `D` and recovery `R` has a severity

```
sev(t) = 1                          if s <= t < s + D
       = 1 - (t - (s + D)) / R      if s + D <= t < s + D + R   (only when R > 0)
       = 0                          otherwise
```

and multiplies success probability and latency by

```
E_e(t)   = 1 - sev(t) * (1 - srFactor)          (srFactor 0 = full outage, 1 = no effect)
L_e(t)   = 1 + sev(t) * (latencyFactor - 1)
```

Repeating events (`repeatEvery > 0`) have occurrences at `s + k * repeatEvery` for `k = 0 .. repeatCount - 1`; occurrences never overlap (validation requires `repeatEvery >= D + R`). Several events multiply.

Example: outage with `srFactor 0.1`, `D = 45`, `R = 15` starting at 19:30 (minute 1170). At minute 1222.5 the severity is `1 - 7.5 / 15 = 0.5` and `E = 1 - 0.5 * 0.9 = 0.55`, so a gateway with technical SR 0.97 runs at 0.5335.

### 4.3 Latency

Each attempt's latency (milliseconds) is lognormal from the gateway-method p50 and p95 (formula of section 3), multiplied by the latency factors of matching gateway events:

```
latencyMs = exp(mu + sigma * z) * prod L_e(t)
```

with `z` a standard normal drawn in advance for that transaction and attempt slot (common random numbers). Failed attempts have the same latency distribution as successful ones (simplification). Latency here is end-to-end customer time for an attempt (for UPI it includes opening the app and entering the PIN; for collect, approving the request), which is why defaults are seconds, not milliseconds of server time. Rate-limited attempts fail fast with a fixed 200 ms.

Defaults (illustrative, all gateways the same unless a scenario says otherwise), p50 / p95: UPI intent 2,500 / 9,000 ms; UPI collect 20,000 / 90,000 ms; card 4,000 / 15,000 ms (includes the one-time password step); netbanking 15,000 / 60,000 ms.

### 4.4 Capacity

If a gateway has a capacity of `C` attempts per minute, the `(C+1)`-th and later attempts started on it in the same integer minute fail immediately as "rate limited" (retryable, with a fixed latency of 200 ms). Every integer minute has its own counter, including minutes after midnight of the next day, which late retries can reach. Default: no capacity limit. Real gateways throttle in smoother and more varied ways.

## 5. Retries and customer drop-off

After a retryable failure of attempt `k` (0-based) and while `k < maxRetries`:

1. The customer abandons with probability

```
P_drop = min( dropMax, dropBase + dropPerSec * elapsedSec )
```

where `elapsedSec` is the time from arrival to the end of attempt `k`. Defaults (illustrative, not calibrated): `dropBase = 0.15`, `dropPerSec = 0.003`, `dropMax = 0.9`. So after a 3-second UPI intent failure about 16% give up; after a 60-second collect failure about 33%.

2. Otherwise the next attempt starts `delaySec` seconds after the failure (default 3 s) on another gateway (mode "other", default: the strategy chooses again among gateways not yet tried for this transaction; if none is left, the transaction fails) or on the same gateway (mode "same").

Default `maxRetries = 2` (up to 3 attempts). The drop-off model is a stand-in for the well-known fact that each extra step and each second of waiting loses customers; its shape and numbers are assumptions.

Final status of each transaction: **success**, **failed** (last failure was customer-side, or retries exhausted, or no gateway left) or **dropped** (customer abandoned before a retry). Exactly one per transaction.

## 6. Fees

A successful attempt costs the merchant `fixedFee + pctFee / 100 * amount` (rupees) on the gateway that processed it; failed attempts cost nothing (simplification; some contracts charge per attempt, and real pricing has tiers, minimums and monthly fees). Defaults are illustrative: in the base scenario Gateway A charges Rs 0.50 per UPI payment, 1.70% on cards and Rs 8 per netbanking payment; B charges Rs 0.75, 1.90% and Rs 10; C charges Rs 1.00, 2.00% and Rs 12.

Context: UPI person-to-merchant payments have had zero MDR under government policy since 2020 [S4], so real UPI fees, where any exist, come from separate platform arrangements; the small UPI fees here exist only so that the cost-aware router has something to trade off on every method. Card MDR in India has an RBI framework for debit cards [S5] and is otherwise commercially agreed; the card percentages here are illustrative round numbers, not quotes from anyone.

Metrics: **cost per successful transaction** = total fees / successful transactions; **effective fee rate** = total fees / total amount of successful transactions.

## 7. Routing strategies

All strategies choose among **eligible** gateways: active at the decision time, supporting the method, and (for retries in mode "other") not yet tried for this transaction. Learning strategies keep one estimate per (method, gateway) pair, learn only from attempts whose outcome is attributable to the gateway (success, technical decline, rate limit) and **only when the attempt completes** (decision time plus latency), so they never see the future. Ties are broken by the gateway's position in the static priority list.

### 7.1 Static priority

Always the first eligible gateway in a fixed list (default A, B, C, ...). Simple, predictable, cheap to run; blind to changes until someone edits it.

### 7.2 Weighted split

Pick at random in proportion to fixed weights (default 50/30/20), renormalised over eligible gateways. Spreads risk and keeps relationships with several gateways alive; pays for it with traffic on worse gateways.

### 7.3 Rule-based

An ordered list of rules "method M and amount in [min, max) -> gateway G". The first matching rule whose gateway is eligible wins; otherwise the static priority list. This is how many teams encode knowledge ("collect works better on B"). Rules are only as good as the knowledge behind them, and they go stale.

### 7.4 Memory for learning strategies

A learning router must forget, because gateways change. Three options per learning strategy:

- **None:** cumulative counts since midnight.
- **Sliding window of `W` minutes:** only outcomes completed in `(t - W, t]` count [R3].
- **Discounting with half-life `H` minutes:** every count decays continuously, `count <- count * 2^(-(t - t_last) / H)`, applied lazily when the pair is read or updated [R3], [R4].

Example (discount, `H = 20`): a success at minute 0 and a failure at minute 10 give, at minute 30, `alpha = 2^(-30/20) = 0.3536` and `beta = 2^(-20/20) = 0.5`.

### 7.5 Epsilon-greedy (default: window, W = 30 min, epsilon = 0.10)

With probability `epsilon`, pick an eligible gateway uniformly at random (explore). Otherwise pick the one with the highest estimate `successes / attempts` in memory; a pair with no data in memory has estimate 1.0 (optimistic), so new or long-unused gateways get tried [R5].

### 7.6 Thompson sampling (default: discount, H = 20 min)

Each (method, gateway) pair has a Beta posterior over its success probability: prior Beta(1, 1) plus the (decayed) success count `alpha` and failure count `beta`. For each decision, draw `theta_g ~ Beta(1 + alpha_g, 1 + beta_g)` for every eligible gateway and pick the largest [R1], [R2], [R6]. After an attributable outcome `r` (1 success, 0 failure) completes: `alpha += r`, `beta += 1 - r` (after decaying to the completion time).

Why discounting matters: a gateway that was bad an hour ago has its counts decayed towards zero, so its posterior widens back towards the uniform prior and it gets sampled again. That is how the router notices recovery, and it is also why it keeps paying a small exploration cost when nothing changes.

Beta draws use `X / (X + Y)` with `X ~ Gamma(a)`, `Y ~ Gamma(b)` (Marsaglia and Tsang [R8]); both shapes are at least 1 because of the prior.

### 7.7 Cost-aware Thompson sampling (default: discount, H = 20 min, lambda = 0.01 per rupee)

Same posteriors, but the score is

```
score_g = theta_g - lambda * fee_g(amount)
fee_g(amount) = fixedFee_{g,m} + pctFee_{g,m} / 100 * amount
```

`lambda` is "how much success probability I would give up to save one rupee per transaction": 0.01 means Rs 1 is worth 1 percentage point. This is a simple scalarised heuristic (it ignores that fees are charged only on success); it is enough to show the trade-off curve. Example: `theta_A = 0.95`, `fee_A = Rs 20`; `theta_B = 0.90`, `fee_B = Rs 14`; with `lambda = 0.01` the scores are 0.75 and 0.76, so B wins.

### 7.8 Oracle (reference, not a strategy)

At each attempt, the eligible gateway with the highest true current technical success probability `q_{g,m}(t)` (section 4.1, with events, ignoring capacity and bank factors, which are the same for every gateway). The oracle is greedy on success, not on cost, and is not guaranteed optimal once retries, capacity and drop-off are involved. It answers "how much success did the router leave on the table by not knowing the truth?".

## 8. Metrics and statistics

Per strategy and seed (a "run"): with `N` transactions,

| Metric | Definition |
|---|---|
| Order SR | successful transactions / N |
| First-attempt SR | transactions whose first attempt succeeded / N |
| Attempt SR | successful attempts / attempts |
| Retries per transaction | (attempts - N) / N |
| Drop-off rate | dropped / N |
| Failed rate | failed / N (split by final reason: customer decline, technical decline, rate limited, no route) |
| Cost per success | total fees / successful transactions |
| Effective fee rate | total fees / successful amount |
| Time to success p50, p95 | nearest-rank percentiles of (success completion time - arrival), seconds, successful transactions only |
| Routable regret per 1,000 | 1000 / N * sum, over the first attempts of transactions that are not customer-declined, of (q*(t) - q_chosen(t)), where q* is the oracle's best technical probability among eligible gateways at the decision time |

Regret uses true probabilities (expected successes lost), not realised outcomes, so it has low noise, is never negative, and is exactly 0 for the oracle. It excludes customer-side and bank-side effects, which routing cannot change.

**Across seeds.** Each metric is computed per seed, then summarised as mean, sample standard deviation `s` and a 95% Student t-interval:

```
mean +- t_{0.975, n-1} * s / sqrt(n)
```

with `n` the number of seeds [R9]. **Paired differences** between two strategies are computed seed by seed (`d_i = metric_A,i - metric_B,i`) and summarised the same way; because both saw the same traffic, paired intervals are much narrower than comparing two separate intervals. These intervals describe **simulation noise under the stated assumptions only**. They say nothing about uncertainty in the assumptions themselves, which is far larger.

Worked example: per-seed values 0.95, 0.97, 0.96, 0.94, 0.98 give mean 0.96, `s = sqrt(0.001 / 4) = 0.0158114`, `t_{0.975,4} = 2.7764`, half-width `2.7764 * 0.0158114 / sqrt(5) = 0.0196321`, interval [0.9403679, 0.9796321].

**Over time.** Charts use 15-minute buckets by arrival time, pooled across seeds (sum of successes / sum of transactions). Window metrics (for example "during the outage") use the buckets inside the scenario's focus window, computed per seed and then averaged with intervals.

## 9. Parameter table

"Illustrative" means chosen by the author to make mechanisms visible at a plausible order of magnitude; it is not a measurement and not anyone's real figure.

| Parameter | Default | Source |
|---|---|---|
| Simulated duration | 1 day (1,440 min) | Design choice |
| Transactions per day | 10,000 | Illustrative (mid-sized online merchant); performance budget is set on it |
| Hourly weights | Section 3 (evening peak) | Illustrative shape |
| Method mix | 55 / 10 / 25 / 10 | Illustrative; UPI's dominance by volume per [S1], [S2] |
| Amount p50 / p95 | Section 3 | Illustrative; average UPI ticket size can be derived from NPCI monthly value / volume [S1] as an order-of-magnitude check |
| Bank mix and factors | 40 / 35 / 25, factor 1.0 | Illustrative |
| Customer-side decline rates | 0.05 / 0.18 / 0.07 / 0.10 | Illustrative; structure (business vs technical declines) per [S3] |
| Technical SR per gateway and method | Scenario tables (SPEC 6.1 and 6.2), 0.85 to 0.99 | Illustrative and deliberately pessimistic: technical failure rates are well above public ecosystem technical-decline figures [S3], [S7] (section 4.1); chosen so that differences of 2 to 8 points exist, as orchestration vendors publicly say gateway performance varies by method and over time [S6] |
| Amount clip | Rs 1 to Rs 2,00,000 | Illustrative (keeps the lognormal tail finite) |
| Rate-limited attempt latency | 200 ms | Illustrative (a throttled request fails fast) |
| Statistics bucket size | 15 minutes | Design choice (96 buckets per day; fine enough to see a 10-minute flap, coarse enough to be readable) |
| Latency p50 / p95 | Section 4.3 | Illustrative (customer-perceived time including authentication) |
| Fees | Section 6 | Illustrative; context [S4], [S5] |
| Capacity | none | Design choice |
| Events | Scenario-specific | Illustrative stories |
| Max retries, mode, delay | 2, other, 3 s | Illustrative |
| Drop-off base, per second, max | 0.15, 0.003, 0.9 | Illustrative, not calibrated |
| Static priority, weighted split, rules | A, B, C; 50 / 30 / 20; the SPEC 6.1 rules list | Illustrative (the large-card rule to C is a deliberately stale belief: C is not better for large card payments in this model) |
| Epsilon, window | 0.10, 30 min | Common textbook choices [R5]; not tuned |
| Thompson prior | Beta(1, 1) for every (method, gateway) pair | Design choice (uniform prior, the textbook default [R2], [R6]) |
| Epsilon-greedy estimate for an empty cell | 1.0 (optimistic) | Design choice [R5] |
| Thompson half-life | 20 min | Design choice: long enough for about 100 effective observations on the busiest pair, short enough to react within minutes; not tuned |
| Cost-aware lambda | 0.01 per rupee | Illustrative |
| Seeds (UI and CLI default) | 20, starting at 1 (= the robustness set, so a visitor's first run is a tested one) | Design choice (budget and stability) |
| Results seed set | 101 to 130 | Fixed in SPEC 6.5 before measurement |
| Robustness seed set | 1 to 20 | Fixed in SPEC 6.5 before measurement |
| Pilot seed set | 501 to 520 | Design-phase sanity check of the expectations only (SPEC 6.6) |

## 10. Limitations (what the model leaves out)

- **Not a forecast.** The defaults are illustrative; real success rates, fees, latencies and drop-off differ by merchant, method, bank, app, time and contract.
- **Exaggerated technical failures.** Default technical failure rates are deliberately much larger than public ecosystem technical-decline figures (section 4.1), so that routing differences show within one simulated day. Technical SR levels are therefore lower, and the gains between strategies larger, than a real merchant would usually see; the direction and the mechanisms are what the scenarios teach.
- **Independence.** Apart from the per-transaction customer-decline flag, attempts are independent given their probabilities. Real failures are correlated (the same card, the same bank, the same device), which usually makes retries less effective than here.
- **No context beyond method.** Learning routers do not learn per bank, card network, BIN range, amount band or device, which real routers often do. A bank outage therefore looks like a small drop on every gateway.
- **No feedback quirks.** Outcomes are known exactly when the attempt completes. Real systems have pending states, late webhooks, timeouts with unknown outcomes and reconciliation corrections.
- **Fees** are charged only on success, without tiers, minimums, taxes or monthly fees; cost-aware scoring is a simple heuristic.
- **Capacity** is a hard per-minute cap; real throttling is smoother and may degrade latency first.
- **Drop-off** is a simple linear-in-waiting-time model with made-up coefficients.
- **One day**, one merchant, no weekly or festive seasonality, no fraud or risk declines.
- **Each strategy in its own world.** In real life, strategies tested side by side share gateways and capacity (interference), and gateway behaviour can react to traffic shifts. That is one reason to validate routers with switchback experiments [R10] rather than only per-user A/B splits.
- **Hyperparameters are not tuned.** Each learning strategy uses the same defaults in every scenario; better or worse settings exist for each scenario, which the Configure tab lets you explore.
- **Reproducibility scope.** The same configuration and seeds give byte-identical results in Node (the reference for RESULTS.md). Browsers use the same code; the smoke test checks that a browser run matches Node exactly on a reference case. Floating-point library differences between JavaScript engines could in principle flip an extremely rare comparison; none is expected.
- **Intervals** cover simulation noise only (section 8).

## 11. Sources

Public sources for structure and orders of magnitude (S) and for methods (R). The implementer opens each before citing details (SPEC section 18); if a detail cannot be confirmed, the source is cited without that detail.

- [S1] National Payments Corporation of India (NPCI), "UPI Product Statistics" page (monthly volume and value), https://www.npci.org.in/what-we-do/upi/product-statistics.
- [S2] Reserve Bank of India, "Payment System Indicators" (monthly, in the RBI Bulletin and the Database on Indian Economy) and the RBI Annual Report chapter on payment and settlement systems (share of UPI in retail digital payments), https://www.rbi.org.in.
- [S3] NPCI, "UPI Ecosystem Statistics" page, including the monthly performance of remitter banks with approved, business-decline (BD) and technical-decline (TD) percentages, https://www.npci.org.in/what-we-do/upi/upi-ecosystem-statistics.
- [S4] Section 269SU of the Income-tax Act, 1961 (inserted by the Finance (No. 2) Act, 2019) and the related notification making MDR not applicable to prescribed electronic modes, including UPI, from 1 January 2020.
- [S5] Reserve Bank of India, "Rationalisation of Merchant Discount Rate (MDR) for Debit Card Transactions", circular of December 2017.
- [S6] Public documentation of the open-source Hyperswitch payment orchestrator (routing types: rule-based, volume split, success-rate-based; intelligent-routing page: https://docs.hyperswitch.io/explore-hyperswitch/workflows/intelligent-routing/auth-rate-based-routing; repository: https://github.com/juspay/hyperswitch) and Juspay's open-source decision engine for success-rate-based gateway selection (https://github.com/juspay/decision-engine). Used only to describe the strategy families (and, if confirmed on the page, the description of routing as a non-stationary multi-armed bandit problem), not for any numbers.
- [S7] Razorpay blog article on payment success-rate optimisation in India (exact title to be confirmed when citing), https://razorpay.com/blog/payment-success-rate-optimization-india/. Cited only for its public statement of an overall UPI technical-decline rate of about 0.8%, as context for section 4.1, if confirmed (SPEC section 18).
- [R1] Thompson, W. R. (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. Biometrika 25(3/4), 285-294.
- [R2] Chapelle, O. and Li, L. (2011). An empirical evaluation of Thompson sampling. NeurIPS 24.
- [R3] Garivier, A. and Moulines, E. (2011). On upper-confidence bound policies for switching bandit problems. ALT 2011 (discounted and sliding-window approaches).
- [R4] Raj, V. and Kalyani, S. (2017). Taming non-stationary bandits: a Bayesian approach. arXiv:1707.09727 (discounted Thompson sampling).
- [R5] Sutton, R. S. and Barto, A. G. (2018). Reinforcement Learning: An Introduction, 2nd ed., chapter 2 (epsilon-greedy, optimistic initial values).
- [R6] Russo, D. J., Van Roy, B., Kazerouni, A., Osband, I. and Wen, Z. (2018). A tutorial on Thompson sampling. Foundations and Trends in Machine Learning 11(1).
- [R7] Box, G. E. P. and Muller, M. E. (1958). A note on the generation of random normal deviates. Annals of Mathematical Statistics 29(2), 610-611.
- [R8] Marsaglia, G. and Tsang, W. W. (2000). A simple method for generating gamma variables. ACM Transactions on Mathematical Software 26(3), 363-372.
- [R9] Student (1908). The probable error of a mean. Biometrika 6(1), 1-25; and Abramowitz, M. and Stegun, I. A. (1964), Handbook of Mathematical Functions, 26.7.5 (t quantile expansion).
- [R10] Bojinov, I., Simchi-Levi, D. and Zhao, J. (2023). Design and analysis of switchback experiments. Management Science 69(7), 3759-3777.
- [R11] Law, A. M. (2015). Simulation Modeling and Analysis, 5th ed. (common random numbers for paired comparisons).
- [R12] Knuth, D. E. (1997). The Art of Computer Programming, vol. 2, 3rd ed. (Poisson generation by multiplication of uniforms).
- mulberry32 PRNG (Tommy Ettinger, public domain); FNV-1a hash (Fowler, Noll, Vo; public domain).
