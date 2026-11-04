import { classifyPickerAction } from "./dashboard-synthetic-storage.mjs";
import { storageError } from "./catalog-storage.mjs";

export function chooseSyntheticFolder({ config, token, title = "Choose a fresh synthetic destination" }) {
  return new Promise((resolve, reject) => {
    const picker = new google.picker.PickerBuilder()
      .addView(new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes("application/vnd.google-apps.folder"))
      .setOAuthToken(token()).setDeveloperKey(config.apiKey).setAppId(config.projectNumber)
      .setOrigin(location.origin).setTitle(title).setCallback(async (data) => {
        const action = classifyPickerAction(data?.action, google.picker.Action);
        if (action === "pending") return;
        if (action === "cancelled") return reject(storageError("selection-cancelled", "Folder selection cancelled."));
        try {
          const id = data.docs?.[0]?.id;
          if (!id) throw storageError("missing-folder", "Picker did not return a folder.");
          const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?fields=id,name,mimeType,trashed", {
            headers: { Authorization: "Bearer " + token() } });
          if (!response.ok) throw storageError("authorization-required", "The selected folder could not be verified. Reconnect and retry.");
          const folder = await response.json();
          if (folder.id !== id || folder.trashed || folder.mimeType !== "application/vnd.google-apps.folder" ||
              folder.name === "finance-tracker-database" || !/synthetic/i.test(folder.name || "")) {
            throw storageError("synthetic-folder-required", "Choose a dedicated synthetic folder containing no financial records.");
          }
          if (!confirm("Confirm that “" + folder.name + "” contains only invented test data. Existing files will be preserved.")) throw storageError("selection-cancelled", "Selection cancelled.");
          resolve(folder);
        } catch (error) { reject(error); }
      }).build();
    picker.setVisible(true);
  });
}
