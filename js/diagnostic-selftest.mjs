// Deliberately isolated developer control: no writes, retries, network or persistence.
import {leaveBreadcrumb} from './error-reporting.mjs';
import {AppError} from './app-error.mjs';
import { showDiagnostic } from './app-diagnostics.mjs';
export function installDiagnosticSelfTest({button, target, onReport = () => {}, document = globalThis.document, navigator = globalThis.navigator}) {
  button?.addEventListener('click', () => {
    leaveBreadcrumb({e:'action.start',actionId:'diagnostic-self-test'});
    const error = new AppError('diagnostic-self-test');
    target.textContent = showDiagnostic(error, {surface:'workspace', page:'storage', actionId:'diagnostic-self-test', target, document, navigator});
    leaveBreadcrumb({e:'action.fail',actionId:'diagnostic-self-test',code:'diagnostic-self-test'});
    onReport();
  });
}
