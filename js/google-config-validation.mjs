export function validateGoogleConfig(config) {
  if (!config || !config.clientId) {
    throw new Error("The deployed Google OAuth client ID is missing. Check the repository's deployment configuration.");
  }
  if (!config.apiKey) {
    throw new Error("The deployed restricted Picker API key is missing. Check the repository's deployment configuration.");
  }
  if (!/^\d+$/.test(String(config.projectNumber || ""))) {
    throw new Error("The deployed Google Cloud project number is missing or invalid.");
  }
  return true;
}
