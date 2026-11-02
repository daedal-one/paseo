import { contextBridge, ipcRenderer } from "electron";
import type { CanonicalRequest, CanonicalSocketEvent } from "@getpaseo/protocol/dsh-canonical";

contextBridge.exposeInMainWorld(
  "__DSH_REMOTE_ADMISSION__",
  ipcRenderer.sendSync("daedal:canonical:admission"),
);
contextBridge.exposeInMainWorld("__DSH_NATIVE__", {
  request: (request: CanonicalRequest) => ipcRenderer.invoke("daedal:canonical:request", request),
  subscribe: (listener: (event: CanonicalSocketEvent) => void) => {
    ipcRenderer.on("daedal:canonical:socket", (_event, value: CanonicalSocketEvent) =>
      listener(value),
    );
  },
});
