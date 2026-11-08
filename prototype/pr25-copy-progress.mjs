import { createElapsedTimer, formatElapsed } from "./pr28-testing-timing.mjs";

// Fixed presentation labels only. Never render archive fields, locators, or
// provider messages. A phase is an observation, not an acceptance result.
const phases = Object.freeze({
  starting: "Starting operation",
  "choosing-source": "Waiting for your existing completed source selection",
  "releasing-source": "Releasing the source session",
  "choosing-destination": "Waiting for a fresh destination selection",
  "opening-destination": "Opening the destination session",
  "loading-archive": "Reading the selected archive",
  "source-verification": "Verifying source history",
  "archive-verification": "Verifying archive integrity and history",
  "destination-preparation": "Preparing the fresh destination",
  "copying-objects": "Copying and checking immutable objects",
  "destination-verification": "Verifying destination history",
  "source-recheck": "Rechecking source ownership and manifest",
  "publishing-manifest": "Publishing the destination manifest",
  "final-verification": "Reopening and verifying the destination",
  "releasing-destination": "Releasing the destination session"
});

export function copyProgressText(event) {
  const phase = event?.phase;
  if (typeof phase !== "string" || !Object.hasOwn(phases, phase)) return null;
  const { completed, total } = event;
  const counted = phase === "copying-objects" && Number.isSafeInteger(completed) && completed >= 0 &&
    Number.isSafeInteger(total) && total >= completed;
  return { phase: phases[phase], count: counted ? `Objects copied and checked: ${completed} of ${total}. Final verification still required.` : "" };
}

// This observer has no storage decisions. Broken clocks, timers, or display
// nodes must not prevent the operation or replace its original outcome.
export function startCopyProgress({ region, phase, count, elapsed,
  now = () => globalThis.performance?.now?.(),
  schedule = (callback) => globalThis.setInterval(callback, 1000),
  cancel = (handle) => globalThis.clearInterval(handle) } = {}) {
  const timer = createElapsedTimer(now);
  let active = true, interval;
  const safely = (work) => { try { work(); } catch { /* Presentation only. */ } };
  const write = (node, text) => safely(() => { if (node.textContent !== text) node.textContent = text; });
  const renderElapsed = (finished = false) => {
    const measured = formatElapsed(finished ? timer.stop() : timer.elapsedMs());
    write(elapsed, (finished ? "Total time: " : "Elapsed: ") + measured + ".");
  };
  const onProgress = (event) => safely(() => {
    if (!active) return;
    const text = copyProgressText(event);
    if (!text) return;
    write(phase, text.phase + ".");
    write(count, text.count);
    safely(() => { count.hidden = !text.count; });
  });
  safely(() => { region.hidden = false; });
  onProgress({ phase: "starting" });
  renderElapsed();
  safely(() => { interval = schedule(() => { if (active) renderElapsed(); }); });
  return Object.freeze({
    onProgress,
    setPhase: (phase) => onProgress({ phase }),
    finish(succeeded) {
      if (!active) return;
      active = false;
      safely(() => cancel(interval));
      renderElapsed(true);
      write(phase, succeeded === true ? "Operation finished. See result above." : "Operation did not complete. See result above.");
    }
  });
}
