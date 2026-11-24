import {buildManualHistory} from './model.mjs';
import {fail} from '../../js/app-error.mjs';

const FORMAT = 'finance-tracker-private-manual-history-draft';
export const DRAFT_MAX_BYTES = 4 * 1024 * 1024;
const text = value => typeof value === 'string' && value.length <= 500;
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const reject = () => fail('invalid-historical-summary-input');
const flags = ['zeroIncome','zeroExpenses','completeIncome','completeExpenses'];
const strings = ['month','workbook','worksheet','currency','netWorth'];
const hasRows = rows => Array.isArray(rows) && rows.length <= 600 && rows.every(row =>
  exact(row,['label','amount']) && text(row.label) && text(row.amount));

export function decodeDraft(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > DRAFT_MAX_BYTES) reject();
  let file;
  try { file = JSON.parse(raw); } catch { reject(); }
  if (!exact(file,['format','version','end','sourceId','months']) || file.format !== FORMAT ||
      file.version !== 1 || !text(file.end) || !text(file.sourceId) || !Array.isArray(file.months) ||
      file.months.length < 1 || file.months.length > 600 || !file.months.every(month =>
        exact(month,[...strings,...flags,'income','expenses']) && strings.every(key => text(month[key])) &&
        flags.every(key => typeof month[key] === 'boolean') &&
        hasRows(month.income) && hasRows(month.expenses))) reject();
  const {end,sourceId,months} = file;
  buildManualHistory({start:'2023-01',end,sourceId,months});
  return {end,sourceId,months};
}

export function encodeDraft({end,sourceId,months}) {
  const raw = JSON.stringify({format:FORMAT,version:1,end,sourceId,months},null,2)+'\n';
  decodeDraft(raw);
  return raw;
}
