const CURRENCY_EXPONENTS = Object.freeze({ USD: 2, CAD: 2, EUR: 2, GBP: 2, JPY: 0, KRW: 0, KWD: 3, BHD: 3 });

export function parseMoney(value, currency) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new TypeError("invalid-money");
  }
  const text = value.trim();
  const exponent = CURRENCY_EXPONENTS[currency];
  if (Number.isInteger(exponent)) {
    const negative = text.startsWith("-");
    const unsigned = negative ? text.slice(1) : text;
    const [whole, fraction = ""] = unsigned.split(".");
    if (fraction.length > exponent) throw new TypeError("unsupported-money-precision");
    const minor = Number(whole) * (10 ** exponent) + Number((fraction + "0".repeat(exponent)).slice(0, exponent) || "0");
    if (!Number.isSafeInteger(minor)) throw new RangeError("money-out-of-range");
    return { amountMinor: negative ? -minor : minor, amountDecimal: null, currency };
  }
  return { amountMinor: null, amountDecimal: text, currency };
}

export function recognizeFormat(sourceFormat) {
  return new Set(["wells-fargo-csv-v1", "sofi-csv-v1", "fidelity-accounts-history-csv-v1"]).has(sourceFormat);
}

function sameComposite(a, b) {
  return a.accountId === b.accountId &&
    a.currency === b.currency &&
    a.amountMinor === b.amountMinor &&
    a.effectiveDate === b.effectiveDate &&
    (a.normalizedDescription ?? a.sourceDescription ?? "") === (b.normalizedDescription ?? b.sourceDescription ?? "") &&
    (a.sourceAction ?? "") === (b.sourceAction ?? "");
}

function isPendingPostedTransition(oldRow, newRow) {
  return oldRow.lifecycleStatus === "pending" && newRow.lifecycleStatus === "posted" &&
    oldRow.accountId === newRow.accountId && oldRow.currency === newRow.currency &&
    oldRow.amountMinor === newRow.amountMinor;
}

export function reconcileImport({
  institutionId, accountId, sourceFormat, fileFingerprint, rows,
  existingActivities = [], existingObservations = [], completedRuns = [],
}) {
  if (!accountId) throw new TypeError("explicit-account-mapping-required");
  if (!recognizeFormat(sourceFormat)) throw new TypeError("unsupported-source-format");
  if (!Array.isArray(rows)) throw new TypeError("rows-must-be-array");

  const prior = completedRuns.find((run) => run.status !== "failed" &&
    run.accountId === accountId && run.institutionId === institutionId &&
    run.sourceFormat === sourceFormat && run.fileFingerprint === fileFingerprint);
  if (prior) {
    return {
      status: "no-op", noOpOfImportRunId: prior.importRunId,
      activities: [], observations: [], events: [],
      counts: { rowsSeen: 0, rowsRecognized: 0, created: 0, matched: 0, review: 0, rejected: 0, ignored: 0 },
      coverageStart: null, coverageEnd: null,
    };
  }

  const activities = [];
  const observations = [];
  const events = [];
  const counts = { rowsSeen: rows.length, rowsRecognized: 0, created: 0, matched: 0, review: 0, rejected: 0, ignored: 0 };
  const validDates = [];

  for (const row of rows) {
    if (!row || row.valid === false || typeof row.effectiveDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveDate) ||
        typeof row.sourceDescription !== "string" ||
        (row.amountMinor !== null && row.amountMinor !== undefined && !Number.isSafeInteger(row.amountMinor))) {
      counts.rejected++;
      counts.rowsRecognized++;
      observations.push({ rowOrdinal: row?.rowOrdinal ?? null, activityId: null, disposition: "rejected", reasonCode: row?.errorCode ?? "invalid-row" });
      continue;
    }

    counts.rowsRecognized++;
    validDates.push(row.effectiveDate);
    const incoming = { ...row, accountId, institutionId };
    let match = null;
    let disposition = "created";
    let reasonCode = null;

    if (row.sourceRecordId) {
      const candidates = [...existingObservations, ...observations]
        .filter((obs) => obs.sourceRecordId === row.sourceRecordId && obs.accountId === accountId && obs.activityId)
        .map((obs) => existingActivities.find((a) => a.activityId === obs.activityId) ?? activities.find((a) => a.activityId === obs.activityId))
        .filter(Boolean);
      const unique = [...new Map(candidates.map((a) => [a.activityId, a])).values()];
      if (unique.length > 1) {
        disposition = "review"; reasonCode = "source-id-multiple-candidates";
      } else if (unique.length === 1) {
        match = unique[0];
        if (match.currency !== (row.currency ?? null) || match.amountMinor !== (row.amountMinor ?? null)) {
          if (row.correctionOfActivityId === match.activityId) {
            disposition = "matched";
            events.push({ eventType: "correction", activityId: match.activityId, observationRowOrdinal: row.rowOrdinal, priorAmountMinor: match.amountMinor ?? null, proposedAmountMinor: row.amountMinor ?? null, appendOnly: true });
          } else {
            disposition = "review"; reasonCode = "source-id-conflict";
          }
        } else if (isPendingPostedTransition(match, incoming)) {
          disposition = "matched";
          events.push({ eventType: "lifecycle-transition", activityId: match.activityId, from: "pending", to: "posted", observationRowOrdinal: row.rowOrdinal, appendOnly: true });
        } else {
          disposition = "matched";
        }
      }
    } else {
      const candidates = existingActivities.filter((a) => sameComposite(a, incoming));
      if (candidates.length === 1) {
        match = candidates[0];
        disposition = "matched";
      } else if (candidates.length > 1) {
        disposition = "review"; reasonCode = "ambiguous-composite-match";
      }
    }

    let activityId = match?.activityId ?? null;
    if (disposition === "created") {
      activityId = "synthetic-activity-" + String(activities.length + 1);
      activities.push({ ...incoming, activityId, processingStatus: "processed" });
      counts.created++;
    } else if (disposition === "matched") {
      counts.matched++;
    } else if (disposition === "review") {
      counts.review++;
    }

    observations.push({
      rowOrdinal: row.rowOrdinal ?? observations.length + 1, accountId, institutionId,
      sourceRecordId: row.sourceRecordId ?? null, activityId: disposition === "review" ? null : activityId,
      sourceFields: row.sourceFields ?? {}, disposition, reasonCode,
      sourceRowFingerprint: row.sourceRowFingerprint ?? null,
    });
  }

  const unresolved = counts.review > 0 || counts.rejected > 0;
  return {
    status: unresolved ? "needs-review" : "processed",
    activities, observations, events, counts,
    coverageStart: validDates.length ? validDates.sort()[0] : null,
    coverageEnd: validDates.length ? validDates.sort().at(-1) : null,
  };
}
