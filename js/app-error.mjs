import {getEntry} from './error-registry.mjs';
// For new throw sites. Existing storage classes remain unchanged to preserve
// instanceof/name/code behavior at recovery and cancellation boundaries.
export class AppError extends Error {
  constructor(code,{cause}={}) {
    if(!getEntry(code))throw new TypeError('Unregistered application error code');
    super(code,cause===undefined?undefined:{cause});
    this.name='AppError';this.code=code;
  }
}
export function fail(code,options){throw new AppError(code,options);}
