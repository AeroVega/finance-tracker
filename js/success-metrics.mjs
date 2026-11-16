import {safeRequestMetrics,safePurposeMetrics} from './drive-request-metrics.mjs';
const actions=new Map([['open-ledger','open'],['reopen-ledger','reopen'],['save-ledger','save'],['save-preview','seed']]);
const reasons=new Set(['none','source-evidence','unsupported-operation','custom-verifier','custom-operation','custom-owner','custom-transport','custom-history','nonfresh']);
// One detached, scalar-only result. Never inspect application data or errors.
export function successfulActionSummary(input={}){
 try{
  const {actionId,elapsedMs,requests,manifestPatches,publication,purposes}=input;
  const action=actions.get(actionId);if(!action||!Number.isSafeInteger(elapsedMs)||elapsedMs<0)return null;
  const aggregate=safeRequestMetrics(requests);
  let breakdown=aggregate?safePurposeMetrics(purposes):null;
  if(breakdown&&(breakdown.reduce((n,row)=>n+row.count,0)!==aggregate.requests||breakdown.reduce((n,row)=>n+row.completed,0)!==aggregate.completed||breakdown.reduce((n,row)=>n+row.headerMs,0)!==aggregate.requestMs))breakdown=null;
  const count=aggregate&&Number.isSafeInteger(manifestPatches)&&manifestPatches>=0&&manifestPatches<=aggregate.patch?manifestPatches:null;
  return {action,elapsedMs,requests:aggregate,requestCoverage:aggregate?'lifecycle-only':'unavailable',manifestPatches:count,purposes:breakdown,
   path:publication&&['native','legacy'].includes(publication.path)?publication.path:'unavailable',
   reason:publication&&reasons.has(publication.reason)?publication.reason:'unavailable'};
 }catch{return null;}
}
