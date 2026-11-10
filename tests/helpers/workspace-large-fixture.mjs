import {createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvents} from '../../js/canonical-import.mjs';
import {replayOptions, replayRow, replayInput} from './ledger-replay-fixtures.mjs';

/** Entirely invented, deterministic multi-year workload. No provider or private input. */
export function createLargeWorkspaceFixture({perAccount = 750, corrections = 400, unresolvedPerAccount = 80} = {}) {
  if (!Number.isSafeInteger(perAccount) || perAccount < 1 || !Number.isSafeInteger(corrections) || corrections < 0 ||
      !Number.isSafeInteger(unresolvedPerAccount) || unresolvedPerAccount < 0) throw new TypeError('invalid-scale-fixture-size');
  const options = replayOptions();
  let ledger = createLedger(options);
  for (let i = 0; i < 4; i++) ledger = registerAccount(ledger, {
    institutionId:'sofi', name:`Invented scale account ${i}`, currency:i % 2 ? 'EUR' : 'USD', accountType:'checking',
  }, options);
  for (const [accountIndex, account] of ledger.accounts.entries()) {
    const rows = Array.from({length:perAccount}, (_, i) => replayRow(i, {
      sourceDescription:`INVENTED SCALE SHOP ${accountIndex} ${i}`, normalizedDescription:`invented scale shop ${accountIndex} ${i}`,
      amountText:i % 2 ? '-1.25' : '10.00', currency:account.currency,
      effectiveDate:`${2023 + Math.floor(i / 336)}-${String(1 + Math.floor(i % 336 / 28)).padStart(2,'0')}-${String(1 + i % 28).padStart(2,'0')}`,
    }));
    const input = replayInput(account, rows, `invented-scale-${accountIndex}`);
    input.coverageByAccount[account.accountId] = {start:'2023-01-01', end:'2030-12-31', provenance:'source-confirmed'};
    ledger = prepareCanonicalImport(ledger, input, options).ledger;
    const invalid = replayInput(account, Array.from({length:unresolvedPerAccount}, (_, i) => replayRow(i, {
      sourceDescription:`INVENTED UNRESOLVED ${accountIndex} ${i}`, valid:false, errorCode:'invented-invalid-row', effectiveDate:i % 2 ? '2023-01-15' : null,
      currency:account.currency,
    })), `invented-unresolved-${accountIndex}`);
    invalid.coverageByAccount[account.accountId] = {start:'2023-01-01', end:'2030-12-31', provenance:'source-confirmed'};
    ledger = prepareCanonicalImport(ledger, invalid, options).ledger;
  }
  ledger = applyFinancialEvents(ledger, ledger.activities.map((activity, i) => ({type:'classification', activityId:activity.activityId,
    activityKind:activity.amountMinor < 0 ? 'spending' : 'income', categoryId:'invented-scale', commandId:`invented-classification-${i}`})), options);
  ledger = applyFinancialEvents(ledger, Array.from({length:corrections}, (_, i) => {
    const activity = ledger.activities[i % ledger.activities.length];
    return {type:'bank-correction', activityId:activity.activityId, amountText:activity.amountMinor < 0 ? '-2.50' : '20.00',
      evidence:{reason:'Invented scale correction'}, commandId:`invented-correction-${i}`};
  }), options);
  return {ledger, options};
}
