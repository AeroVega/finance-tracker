const messages = Object.freeze({
  "google-config-network": "Google deployment configuration could not be reached because the request failed. Local preview still works; saved copies are unavailable until the configuration can be loaded.",
  "google-config-http": "Google deployment configuration could not be loaded (HTTP {status}). Local preview still works; saved copies are unavailable.",
  "google-config-json": "The deployed Google configuration file is not valid JSON. Local preview still works; saved copies are unavailable.",
  "google-config-invalid": "The deployed Google configuration is incomplete or invalid. Check the Google deployment settings. Local preview still works.",
  "google-libraries-unavailable": "Google's browser libraries did not load ({components}). This is a Google script/network or browser-blocking problem, not a missing deployment configuration. Local preview still works.",
  "google-picker-unavailable": "Google Picker could not initialize. The deployment configuration was loaded, but the Picker library failed. Check Google script access and browser content blockers. Local preview still works."
});

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
