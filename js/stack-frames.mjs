import {DIAGNOSTIC_FILES} from './diagnostic-files.mjs';
const files = new Set(DIAGNOSTIC_FILES);
const defaultBase = new URL('../', import.meta.url).href;
/** Never return URL, function name, error message or untrusted path segments. */
export function safeSourceFile(value, options = {}) {
  if (typeof value !== 'string' || value.length > 2048 || /[%\\?#]/.test(value) || /(^|\/)\.\.?($|\/)/.test(value)) return null;
  try {
    const appBase=options?.appBase??defaultBase;
    const base = new URL(appBase), url = new URL(value);
    if (url.origin !== base.origin || url.protocol !== base.protocol || !url.pathname.startsWith(base.pathname) || url.username || url.password) return null;
    const file = url.pathname.slice(base.pathname.length);
    return files.has(file) ? file : null;
  } catch { return null; }
}
export function parseStack(stack, options = {}) {
  const frames = []; let foreignFrames = 0;
  if (typeof stack !== 'string') return {frames, foreignFrames, truncated:false};
  const bounded = stack.slice(0, 32768), lines = bounded.split('\n', 256);
  for (let index=0;index<lines.length;index++) {
    const line=lines[index];
    if(index===0 && /^\s*(?:[A-Za-z_$][\w$]*Error|Error|DOMException):/.test(line))continue;
    // Safari/JSC first: only the location after @. V8: only a location in an at-frame.
    let location;
    if (line.includes('@')) location = line.slice(line.lastIndexOf('@') + 1);
    else if (/^\s+at\s/.test(line)) location = line.replace(/^\s+at\s+(?:.*?\()?/, '').replace(/\)$/, '');
    else continue; // Includes the first V8 Name: message line and native frames.
    const match = location.match(/^((?:https?:\/\/|file:\/\/\/)[^\s]+):(\d{1,7}):(\d{1,7})$/);
    const file = match && safeSourceFile(match[1], options);
    if (!file) { foreignFrames++; continue; }
    const lineNumber = Number(match[2]), col = Number(match[3]);
    if (lineNumber < 1 || col < 1) { foreignFrames++; continue; }
    if (frames.length < 12) frames.push({file, line:lineNumber, col});
  }
  return {frames, foreignFrames, truncated:stack.length > bounded.length || lines.length === 256};
}
