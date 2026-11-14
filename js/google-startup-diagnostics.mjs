import {startupMessageTemplates as messages} from './error-registry.mjs';

export function googleStartupError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

/** Safe user-facing diagnosis; never includes config values, tokens, or raw provider errors. */
export function googleStartupMessage(error) {
  const code = error?.code;
  if (code === "google-config-http") {
    return messages[code].replace("{status}", String(Number.isInteger(error.status) ? error.status : "unknown"));
  }
  if (code === "google-libraries-unavailable") {
    const components = Array.isArray(error.components) && error.components.length
      ? error.components.join(", ")
      : "one or more required Google scripts";
    return messages[code].replace("{components}", components);
  }
  return messages[code] || "Google startup could not be completed. Local preview still works; saved copies are unavailable.";
}
