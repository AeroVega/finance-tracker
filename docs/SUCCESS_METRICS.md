# Successful storage action observations

Experimental, tab-local diagnostic display under recovery and advanced tools.
Nothing is transmitted or persisted. The display retains one successful storage
action and is cleared explicitly or by reloading the tab. Failure and cancellation
do not replace a prior successful summary.

The summary contains a fixed action label, wall duration, the existing scalar
request aggregate, actual manifest PATCH attempts, and the observed publication
path/fallback reason. It never includes identifiers, hashes, URLs, request or
response bodies, errors, or financial content. Returned summaries are detached.

Request coverage is explicitly **lifecycle-only**: folder picker and connection
preflight requests are excluded. If the lifecycle is created or replaced during
an action, counts are unavailable rather than presenting the previous connection's
window as a complete measurement. The wall duration still covers the whole action.

Manifest attempts are tagged at the request construction site and counted only
when the existing measured fetch is invoked. Session heartbeat PATCHes do not
count; repeated attempts do. A path label is observed from the existing protocol
branch, never inferred from a request total. Initialization and retries can make
a whole action's count differ from the protocol's normal two/four publications.

Publication labels become available to the application only after its existing
successful close, exact manifest check and ownership check. A tab-local monotonic
observation sequence prevents an old engine's prior success from being attributed
to a later action or another engine. This sequence does not participate in storage
authority, ownership, validation, retry, or protocol decisions.

No extra capability/ownership checks, adapter callbacks, phase timers, caching,
network requests or changes to validation are introduced. Missing or invalid
observations are unavailable; diagnostic errors cannot replace action outcomes.

## Request-purpose breakdown

Fixed code-defined labels distinguish metadata, media, owner-list pages,
inventory-list pages, ID generation, immutable creates, manifest PATCH attempts,
session creates/PATCH attempts, and unknown requests. An existing request-options
WeakMap carries labels to the existing measured fetch without inspecting URLs,
identifiers, payloads or responses beyond HTTP status. Every actual fetch attempt
counts, including retries and each listing page; counts are not unique objects.

Each fixed bucket contains count/completed, summed and maximum response-header
latency, exact HTTP 404/409/429 counts, other 4xx and network errors. HTTP 404 does
not establish an expected absence; HTTP 409 does not establish a safe collision.
Header latency excludes response-body consumption and parsing. Concurrent request
latencies overlap, so their sum is neither action wall time nor CPU time. Buckets
remain in the existing tab-only capture window and single successful summary;
clear, reload, cancellation, failure and lifecycle coverage behavior is unchanged.
Unknown labels and unavailable coverage remain explicit. No persistence or
telemetry is added. Existing ownership and native-path checks are unchanged.
