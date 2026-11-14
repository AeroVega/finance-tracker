// Fixed vocabulary. No provider can install its own string fields or validators.
export const ACTIONS = new Set(['preview-position','start-preview','stage-balance','stage-closure','stage-reconciliation','stage-account','stage-holdings','open-ledger','preview-year','save-preview','save-ledger','reopen-ledger','release-ledger','recover-ledger','recover-stale','link-transfer','undo-last-change','revert-all-changes','stage-correction','select-holdings-evidence','select-balance-evidence','diagnostic-self-test','workspace-action']);
export const PAGES = new Set(['overview','transactions','position','holdings','review','reconciliation','storage','activity-detail']);
export const SURFACES = new Set(['workspace','synthetic-year','import','local-preview','developer-tool','copy-guide']);
export const PHASES = new Set(['starting','configuration','connecting','reconnecting','preparing','checking','saving','recovering','reopening','releasing','verifying']);
export const STATES = new Set(['idle','disconnected','connecting','ready','ownership-unknown','ownership-lost','recovering','recovering-session','recovery-required','connection-error','offline','reconnecting','releasing','released','release-unconfirmed','authorization-required','saving','cancelled','error']);
export function read(value, key) { try { return value?.[key]; } catch { return undefined; } }
export const integer = (v, max=1e9) => Number.isSafeInteger(v) && v>=0 && v<=max ? v : undefined;
const pick = (v, values) => values.includes(v) ? v : undefined;
function booleanFields(input, fields) { const out={}; for(const k of fields){const v=read(input,k);if(typeof v==='boolean')out[k]=v;}return out; }
export function safeWorkspace(input) {
  const out=booleanFields(input,['busy','dirty','needsReopen']);
  const lifecycle=read(input,'lifecycle'),ownership=read(input,'ownership');
  if(STATES.has(lifecycle))out.lifecycle=lifecycle;
  if(['owner','not-owner','unknown','released'].includes(ownership))out.ownership=ownership;
  if(read(input,'profile')==='canonical5-physical4')out.profile='canonical5-physical4';
  const ledger=read(input,'ledger');
  if(ledger){
    const synthetic=read(ledger,'syntheticOnly')===true;
    out.ledger={synthetic};
    for(const key of ['accounts','activities','events','stagedChanges']){
      const n=integer(read(ledger,key));
      if(n!==undefined)out.ledger[key]=synthetic?n:(n===0?0:2**Math.ceil(Math.log2(n)));
    }
    out.ledger.counts=synthetic?'exact':'power-of-two-upper-bound';
  }
  return out;
}
export function diagnosticEnvironment({navigator:nav=globalThis.navigator,window:win=globalThis.window,document:doc=globalThis.document}={}) {
  const out={}, ua=read(nav,'userAgent');
  if(typeof ua==='string' && ua.length<4096){
    const ios=ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS) (\d{1,2})/),android=ua.match(/Android (\d{1,2})/),firefox=ua.match(/Firefox\/(\d{1,3})/),chrome=ua.match(/(?:Chrome|CriOS)\/(\d{1,3})/),safari=ua.match(/Version\/(\d{1,3}).*Safari/);
    out.ua={os:ios?'ios':android?'android':/Windows/.test(ua)?'windows':/Macintosh/.test(ua)?'macos':/Linux/.test(ua)?'linux':'other',engine:ios?'webkit':firefox?'gecko':chrome?'blink':/AppleWebKit/.test(ua)?'webkit':'other',browser:firefox?'firefox':chrome?'chrome':safari?'safari':'other'};
    if(ios||android)out.ua.osMajor=Number((ios||android)[1]);
    if(firefox||chrome||safari)out.ua.browserMajor=Number((firefox||chrome||safari)[1]);
  }
  const online=read(nav,'onLine');if(typeof online==='boolean')out.online=online;
  const visibility=pick(read(doc,'visibilityState'),['visible','hidden']);if(visibility)out.visibility=visibility;
  const secureContext=read(win,'isSecureContext');if(typeof secureContext==='boolean')out.secureContext=secureContext;
  try {out.displayMode=read(nav,'standalone')===true || win?.matchMedia?.('(display-mode: standalone)')?.matches===true?'standalone':'browser';}catch{ /* best-effort: environment only */ }
  const w=integer(read(win,'innerWidth'),16384),h=integer(read(win,'innerHeight'),16384),dpr=read(win,'devicePixelRatio');
  if(w!==undefined&&h!==undefined)out.viewport={w,h,...(typeof dpr==='number'&&Number.isFinite(dpr)&&dpr>0&&dpr<=8?{dpr}: {})};
  out.features={clipboard:typeof read(read(nav,'clipboard'),'writeText')==='function',subtleCrypto:!!read(globalThis.crypto,'subtle'),streams:typeof globalThis.ReadableStream==='function'};
  const lang=read(nav,'language');if(typeof lang==='string'&&/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(lang))out.lang=lang.split('-')[0].toLowerCase();
  const offset=new Date().getTimezoneOffset();if(Number.isInteger(offset)&&Math.abs(offset)<=840)out.tzOffsetMin=-offset;
  return out;
}
