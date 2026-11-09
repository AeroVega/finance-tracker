---
name: measurement-and-benchmarks
description: "Use when measuring, comparing, reporting, or questioning performance, latency, throughput, a benchmark, a speedup, or a regression, including when choosing between implementations based on a number."
---

# Measurement and benchmarks

Define the question and the real workload first. Identify the metric, unit, baseline, environment, inputs, and what improvement would matter to the user. State whether the measurement is a proxy and what it omits.

Before comparing runs, check that they perform equivalent work and that the result is used rather than optimized away. Identify the likely limiting resource and record relevant configuration, warmup, concurrency, caching, data size, and system load. Investigate errors, timeouts, and dropped work alongside successful throughput or latency.

Repeat measurements when practical. Report variation and sample size, not only the best result. Check whether the observed change is larger than run-to-run noise and whether the test represents the intended deployment. When results differ unexpectedly, test competing explanations before attributing a cause.

Present the baseline and changed values with units, the calculation, test conditions, limitations, and evidence. Do not infer a production impact from an unrepresentative benchmark. If the environment or data needed to support a conclusion is unavailable, say what remains unverified.

## Check a comparison

1. Write the intended claim with the metric, workload, and data size. Read the harness to learn what it times and what it excludes.
2. Check that both runs do equivalent work and return correct results. Count failures and timeouts. A rejected request can look faster than a successful one.
3. Match the conditions that matter to the decision: build mode, versions, cache state, concurrency, input, and configuration. If one option is untuned, say what the comparison does and does not establish.
4. Repeat each side and alternate their order when practical. Show the individual range and a summary such as the median. A difference smaller than the observed variation is inconclusive without stronger evidence.
5. Identify the likely bottleneck. Measure the load generator as well as the service, and keep profiling runs separate when the profiler changes timing.
6. Check the arithmetic. If a step accounts for 10% of the original elapsed time, removing it entirely cannot reduce total time by more than 10% under the same conditions. Compare throughput against relevant resource limits.
7. Relate a microbenchmark to an end-to-end path. A faster helper is not automatically a faster user experience.

For a rough one-run estimate, label it as such and still check correctness and whether the work ran. For a decision between alternatives, avoid declaring a winner from a single noisy run. Report the measurement, units, run count, range, environment, bottleneck when known, and unresolved gaps.

## Interpret the result

Before collecting measurements, write the decision the result will inform and the size of difference that would matter. Preserve enough run details to repeat the comparison, including the individual results or a distribution and the method used to summarize them.

Investigate a result that exceeds a plausible resource limit or the maximum time attributable to the changed step. It may reflect skipped work, caching, errors, or a different measurement boundary. Do not claim a precise cause from a timing difference alone. If the observations do not distinguish an effect from noise, report the comparison as inconclusive.
