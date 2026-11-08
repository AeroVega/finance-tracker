# Dense invented multi-year CPU fixture

**Verified locally:** The fixture uses public create/register/import/batch command APIs, four persistent accounts, and 195 invented activities per month. One, five, and ten years contain 2,340, 11,700, and 23,400 activities respectively. It includes salary, rent, utilities, 180 card purchases per month, matched payment/transfer legs, refunds, bank corrections, savings interest, and investment contributions/buys/dividends/fees whose lifecycle remains unknown. All monetary inputs are exact decimal strings made from integer cents. Every activity has a stable invented source identifier, one source observation, and explicit source coverage. Classification and correction/refund commands preserve ordered audit events.

The fixture supplies parsed-input records directly: it tests canonical import and replay, not provider CSV parsers. Coverage is invented, not reconciled completeness. Source files remain honestly not-retained. No opening balances, investment performance, real records, network, Drive, or storage operations are supplied. Four whole-period imports keep fixture setup practical; this is not a claim about historical monthly-import setup cost. Repeated observations and category-rule fan-out are covered elsewhere, not by this fixture.

Run `node --test tests/dense-ledger-fixture.test.mjs` and `node tests/benchmark-dense-ledger.mjs /absolute/path/to/baseline.mjs`. The optional baseline must retain its dependencies. `DENSE_YEARS=1,5,10` and `DENSE_REPEATS=3` are defaults. Each comparison asserts complete output equality, including the resulting ledger of one classification command. Baseline and candidate run order alternates between samples. Fixture setup and equality checks are outside the timed calls. Event-type getter reads separately check a linear validation bound; these are not measurements of every CPU operation.

**Open:** Browser/device responsiveness, memory limits on mobile, storage throughput, and live acceptance. Timing is illustrative: shared-host concurrent workloads and garbage collection affect it. RSS includes fixtures, both implementations, retained outputs, and GC high-water behavior, so it is not isolated candidate memory. Production remains NO-GO. No push, merge, deployment, or real-data access is part of this work.

## Local measurement, November 8, 2026

**Verified:** Node 24.22.1, candidate commit `52603c1`, unchanged canonical baseline with scoped category memberships and without chronological replay. Each number is a three-call median, rounded to milliseconds. Every measured call passed complete-output comparison. Other workers were active on the host.

| Years | Activities | Operation | Baseline ms | Candidate ms |
| --- | ---: | --- | ---: | ---: |
| 1 | 2,340 | validate | 162 | 53 |
| 1 | 2,340 | project | 295 | 85 |
| 1 | 2,340 | summary | 315 | 72 |
| 1 | 2,340 | command | 409 | 158 |
| 5 | 11,700 | validate | 1876 | 255 |
| 5 | 11,700 | project | 4324 | 459 |
| 5 | 11,700 | summary | 4307 | 374 |
| 5 | 11,700 | command | 6493 | 915 |
| 10 | 23,400 | validate | 12024 | 587 |
| 10 | 23,400 | project | 31250 | 899 |
| 10 | 23,400 | summary | 31532 | 1022 |
| 10 | 23,400 | command | 21141 | 1681 |

Setup took 0.86, 3.83, and 10.29 seconds, excluded from the operation measurements. Validation event-type reads were 25,464, 127,320, and 254,640. Ten times the events caused exactly ten times these reads. The combined benchmark process reached about 834 MiB RSS at recorded checkpoints. This includes baseline work and retained outputs, not candidate-only memory.

## Candidate-only memory

**Verified locally:** Each size ran in a fresh Node 24.22.1 process with `--expose-gc`, using only candidate `52603c1`. Run `node --expose-gc tests/benchmark-dense-ledger-memory.mjs 10`, replacing 10 with 1 or 5 as needed. The runner forces GC before setup, after setup, and after projection, keeping the ledger and final projection live. Pre-fixture used heap was about 6.87 MiB in every process.

| Years | Retained ledger heap MiB | Ledger plus projection heap MiB | RSS after setup GC MiB | RSS after projection GC MiB | Whole-process high-water RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 13.63 | 15.64 | 157.23 | 157.48 | 157.96 |
| 5 | 39.05 | 49.55 | 322.34 | 321.98 | 343.87 |
| 10 | 70.63 | 91.89 | 448.49 | 447.79 | 489.25 |

Used heap includes the Node runtime and retained objects. RSS also includes reserved heap pages and native allocations; forced GC does not make Node return every page to the OS. The ten-year projection added about 21.26 MiB of retained heap. Its checkpoint before GC used 125.53 MiB heap, but that checkpoint is not a peak measurement. Whole-process RSS high-water includes fixture setup and was already reached before projection in these runs. A true projection-only peak is unavailable because the synchronous operation prevents in-process sampling.

These separate runs had setup times of 0.59, 2.69, and 5.75 seconds and one-call projection times of 69, 314, and 715 milliseconds. Differences from the shared comparison run illustrate timing and GC variability. These numbers do not establish memory savings against the baseline. Browser memory behavior, mobile responsiveness, and safe device limits remain unverified.
