// Preload for the app's own view only (never browsed tabs): exposes the native
// bridge the UI mounts with. Errors reject with the command's message as a
// string, as the UI expects.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("hvnt33", {
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const reply = await ipcRenderer.invoke("hvnt33:invoke", command, args ?? {});
    if (reply?.ok) return reply.value;
    throw String(reply?.error ?? "Failed");
  },
  listen: async (event: string, fn: (payload: unknown) => void) => {
    const handler = (_: IpcRendererEvent, name: string, payload: unknown) => { if (name === event) fn(payload); };
    ipcRenderer.on("hvnt33:event", handler);
    return () => { ipcRenderer.off("hvnt33:event", handler); };
  },
  focusApp: () => ipcRenderer.invoke("hvnt33:invoke", "app_focus", {}).then(() => undefined),
  // Files dropped on the app (for the agent's message): their place on disk.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
