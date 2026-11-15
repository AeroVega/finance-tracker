# Owned staging width-eight experiment

Local candidate only. The owned physical adapter plus private owned preparation
reader path changes its complete-body probe/write batch from four to eight.
Generic preparation, read-only verification, plan traversal, fixed-ID validation,
mutation guards, uncertain-write reconciliation and publication ordering are unchanged.
All probes finish before any writes in a batch, and all issued writes finish before
the batch returns, including failures. Publication cannot overlap those writes.

The larger bound permits eight in-flight immutable creates rather than four.
Failure can therefore leave up to eight batch objects needing fixed-ID recovery,
not just four. Eight maximum-size bodies are 512 KiB instead of 256 KiB before
additional copies, JavaScript overhead and existing caches. This is not a heap bound.
There is no claim that Drive will avoid throttling or that throughput will improve.

Focused tests use eight-way barriers, an eighth-probe refusal, cancellation after
eight creates dispatch, a late eighth-create refusal, a lost response after durable
create, and a post-probe fixed-ID collision. Existing generic callback tests remain.
Before adoption, measure standard/dense staging entry counts, batch waves and elapsed
time separately from total save time. Benchmark instrumentation must remain temporary;
aggregate create counts include unrelated catalog/plan writes and are not stage counts.
