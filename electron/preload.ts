// Minimal, sandbox-safe bridge. Exposes only what the renderer needs: the app
// version and the screen-source picker channel. No Node/require reaches the page.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("streamforge", {
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),
});

// Bridge used only by the screen-share picker window (electron/picker.html).
interface PickerSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string | null;
}

contextBridge.exposeInMainWorld("sharePicker", {
  ready: (): void => ipcRenderer.send("picker:ready"),
  onSources: (cb: (sources: PickerSource[]) => void): void => {
    ipcRenderer.on("picker:sources", (_e, sources: PickerSource[]) =>
      cb(sources),
    );
  },
  choose: (id: string): void => ipcRenderer.send("picker:choose", id),
});
