import { ipcMain, type WebContents, type IpcMainInvokeEvent } from "electron";
import {
  DshAccessError,
  desktopDshCommandSchema,
  type DesktopDshReply,
} from "@getpaseo/protocol/dsh-access";
import { DesktopDshAccess } from "./access.js";
import type { DesktopDshDeviceStore } from "./device-store.js";

interface AppWindow {
  contents: WebContents;
  origin: string;
  epoch: number;
  closing: Promise<void>;
}

/** The sandboxed preload exposes these fixed operations only to registered application frames. */
export class DesktopDshIpc {
  private readonly windows = new Map<number, AppWindow>();
  private readonly access: DesktopDshAccess;
  constructor(store: DesktopDshDeviceStore) {
    this.access = new DesktopDshAccess(store, (id, event) => {
      const window = this.windows.get(id);
      if (
        window === undefined ||
        window.contents.isDestroyed() ||
        window.contents.mainFrame.origin !== window.origin
      )
        return;
      window.contents.mainFrame.send("daedal:dsh:socket", event);
    });
    ipcMain.handle("daedal:dsh:request", (event, input: unknown) => this.request(event, input));
  }

  private async request(event: IpcMainInvokeEvent, input: unknown): Promise<DesktopDshReply> {
    const window = this.windows.get(event.sender.id);
    if (
      window === undefined ||
      window.contents !== event.sender ||
      event.senderFrame === null ||
      event.senderFrame !== window.contents.mainFrame ||
      event.senderFrame.origin !== window.origin
    ) {
      return { ok: false, error: "unsupported-platform" };
    }
    const parsed = desktopDshCommandSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid-response" };
    const epoch = window.epoch;
    try {
      await window.closing;
      if (window.epoch !== epoch || this.windows.get(event.sender.id) !== window)
        throw new DshAccessError("request-cancelled");
      return { ok: true, value: await this.access.run(event.sender.id, parsed.data) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof DshAccessError ? error.code : "transport-failed",
      };
    }
  }

  attach(contents: WebContents, origin: string): void {
    if (this.windows.has(contents.id)) throw new Error("DSH window already registered");
    const window: AppWindow = { contents, origin, epoch: 0, closing: Promise.resolve() };
    this.windows.set(contents.id, window);
    const close = () => {
      window.epoch++;
      const previous = window.closing;
      // Cancel immediately, then retain every prior teardown as the next page's barrier.
      const current = this.access.closeWindow(contents.id);
      window.closing = Promise.all([previous, current]).then(() => undefined);
      // Rejection remains observable by later IPC; suppress only an unhandled rejection.
      void window.closing.catch(() => undefined);
    };
    contents.on("did-start-navigation", (_event, _url, inPage, mainFrame) => {
      if (mainFrame && !inPage) close();
    });
    contents.once("destroyed", () => {
      this.windows.delete(contents.id);
      close();
    });
  }

  async dispose(): Promise<void> {
    ipcMain.removeHandler("daedal:dsh:request");
    const pending = [...this.windows.values()].map((window) => window.closing);
    this.windows.clear();
    await Promise.all([...pending, this.access.dispose()]);
  }
}
