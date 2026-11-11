import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvents, validateLedger } from './canonical-import.mjs';
import { parseProviderCsv } from './provider-csv.mjs';
import { applyPositionEvent } from './financial-position.mjs';

/** Invented statement scenario, separate from the unchanged year recipe.
 * Source references are fixture labels, never real accounts or documents.
 */
export async function createSyntheticFinancialPosition() {
  let sequence = 0;
  const options = { now: () => '2025-02-01T00:00:00.000Z',
    idFactory: () => `f17e0002-2025-4000-8000-${String(++sequence).padStart(12, '0')}` };
  let ledger = createLedger(options);
  const accounts = {};
  const definitions = [
    ['checking', 'wells-fargo', 'checking', '1000.00', '2200.00'],
    ['savings', 'sofi', 'savings', '2000.00', '2500.00'],
    ['card', 'wells-fargo', 'credit-card', '300.00', '300.00'],
    ['brokerage', 'fidelity', 'brokerage', null, '5000.00'],
    ['mortgage', 'wells-fargo', 'mortgage', null, '99000.00'],
    ['autoLoan', 'sofi', 'auto-loan', null, '8000.00'],
  ];
  const rows = {
    checking: [
      ['01/05/2025', 'INVENTED PAYROLL', '2000.00', 'income', 'salary'],
      ['01/10/2025', 'INVENTED GROCER', '-200.00', 'spending', 'groceries'],
      ['01/15/2025', 'INVENTED CARD PAYMENT', '-100.00', 'transfer', 'card-payment'],
      ['01/20/2025', 'INVENTED SAVINGS OUT', '-500.00', 'transfer', 'internal-transfer'],
    ],
    savings: [['2025-01-20', 'INVENTED SAVINGS IN', '500.00', 'transfer', 'internal-transfer']],
    card: [
      ['01/08/2025', 'INVENTED CAFE', '-100.00', 'spending', 'dining'],
      ['01/15/2025', 'INVENTED CARD PAYMENT RECEIVED', '100.00', 'transfer', 'card-payment'],
    ],
  };
  const source = (key, label) => ({ kind: 'statement', reference: `INVENTED ${key} ${label}` });
  const append = command => { ledger = applyPositionEvent(ledger, { ...command, commandId: `invented-position-${++sequence}` }, options); return ledger.positionEvents.at(-1).eventId; };
  for (const [key, institutionId, accountType, opening, closing] of definitions) {
    ledger = registerAccount(ledger, { institutionId, accountType, currency: 'USD', displayName: `Invented ${key === 'autoLoan' ? 'auto loan' : key}` }, options);
    const accountId = ledger.accounts.at(-1).accountId;
    accounts[key] = accountId;
    if (rows[key]) {
      const sourceFormat = institutionId === 'sofi' ? 'sofi-csv-v1' : 'wells-fargo-csv-v1';
      const header = institutionId === 'sofi' ? 'Date,Description,Type,Amount,Status' : 'DATE,DESCRIPTION,AMOUNT,STATUS';
      const data = rows[key].map(([date, description, amount]) => institutionId === 'sofi'
        ? [date, description, 'Transfer', amount, 'Posted'].join(',')
        : [date, description, amount, 'Posted'].join(','));
      const parsed = await parseProviderCsv({ bytes: new TextEncoder().encode([header, ...data].join('\n') + '\n'), sourceFormat });
      ledger = prepareCanonicalImport(ledger, { parsed, syntheticOnly: true, accountMappings: { default: accountId },
        coverageByAccount: { [accountId]: { start: '2025-01-01', end: '2025-01-31', provenance: 'source-confirmed' } } }, options).ledger;
      const activities = ledger.activities.filter(activity => activity.accountId === accountId);
      ledger = applyFinancialEvents(ledger, activities.map((activity, i) => ({ type: 'classification', activityId: activity.activityId,
        activityKind: rows[key][i][3], categoryId: rows[key][i][4], commandId: `invented-position-classify-${++sequence}`,
        evidence: { reason: 'Explicit invented scenario classification.' } })), options);
    }
    const openingBalanceEventId = opening === null ? null : append({ type: 'balance-snapshot', accountId,
      effectiveDate: '2024-12-31', amountText: opening, basis: 'statement', source: source(key, 'opening statement') });
    const closingBalanceEventId = append({ type: 'balance-snapshot', accountId, effectiveDate: '2025-01-31',
      amountText: closing, basis: 'statement', source: source(key, 'closing statement') });
    if (openingBalanceEventId) append({ type: 'reconciliation', accountId, month: '2025-01', openingBalanceEventId,
      closingBalanceEventId, source: source(key, 'January statement reconciliation') });
  }
  append({ type: 'holdings-snapshot', accountId: accounts.brokerage, effectiveDate: '2025-01-31', scope: 'complete',
    holdings: [
      { symbol: 'INVENTED', assetType: 'stock', quantity: '46', valueText: '4600.00' },
      { symbol: 'CASH', assetType: 'cash', quantity: '400', valueText: '400.00' },
    ], source: source('brokerage', 'dated holdings statement') });
  validateLedger(ledger);
  return { syntheticOnly: true, ledger, accounts, asOf: '2025-01-31', month: '2025-01',
    expected: { currency: 'USD', assets: '9700.00', liabilities: '107300.00', netWorth: '-97600.00' },
    limitations: [
      'Invented statements only. No real files, accounts or live prices.',
      'January checking, savings and card movements reconcile to statement balances.',
      'Investment and loan activity coverage is incomplete. Dated balances alone do not establish complete history.',
      'Holdings support the investment total and are never added to it again.',
      'Loan amounts do not establish a principal and interest payment split.',
    ] };
}
