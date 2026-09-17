import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { DesktopDshIpc } from "./ipc";
import { DesktopDshDeviceStore } from "./device-store";
import { DshAccessError, type DesktopDshReply } from "@getpaseo/protocol/dsh-access";
const electron = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: electron }));
const facades: DesktopDshIpc[] = [];
beforeEach(() => {
  electron.handle.mockReset();
  electron.removeHandler.mockReset();
});
afterEach(async () => {
  await Promise.all(facades.splice(0).map((facade) => facade.dispose()));
});
function fixture() {
  const store = new DesktopDshDeviceStore(
    "unused",
    {
      isEncryptionAvailable: () => false,
      getSelectedStorageBackend: () => "",
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    },
    "darwin",
  );
  const list = vi.spyOn(store, "list").mockResolvedValue([]);
  const facade = new DesktopDshIpc(store);
  facades.push(facade);
  const contents = Object.assign(new EventEmitter(), {
    id: 1,
    mainFrame: { origin: "paseo://app", send: vi.fn() },
    isDestroyed: () => false,
  });
  // Only the WebContents fields used by this facade are represented by the test emitter.
  facade.attach(contents as unknown as WebContents, "paseo://app");
  const handler = electron.handle.mock.calls[0][1] as (
    event: IpcMainInvokeEvent,
    input: unknown,
  ) => Promise<DesktopDshReply>;
  const request = (input: unknown, sender = contents, senderFrame: unknown = contents.mainFrame) =>
    handler({ sender, senderFrame } as IpcMainInvokeEvent, input);
  return { facade, contents, list, request };
}

describe("desktop DSH IPC admission", () => {
  it("admits the registered app's top frame and rejects subframes, foreign origins and other contents", async () => {
    const { request, contents, list } = fixture();
    expect(await request({ type: "list" })).toEqual({ ok: true, value: [] });
    expect(await request({ type: "list" }, contents, { origin: "paseo://app" })).toEqual({
      ok: false,
      error: "unsupported-platform",
    });
    contents.mainFrame.origin = "https://foreign.example";
    expect(await request({ type: "list" })).toEqual({ ok: false, error: "unsupported-platform" });
    contents.mainFrame.origin = "paseo://app";
    expect(await request({ type: "list" }, { ...contents, id: 2 } as typeof contents)).toEqual({
      ok: false,
      error: "unsupported-platform",
    });
    expect(list).toHaveBeenCalledOnce();
  });
  it("rejects invalid IPC and keeps diagnostic details inside the main process", async () => {
    const { request, list } = fixture();
    expect(await request({ type: "list", extra: "field" })).toEqual({
      ok: false,
      error: "invalid-response",
    });
    list.mockRejectedValueOnce(new Error("private-file-and-credential"));
    expect(await request({ type: "list" })).toEqual({ ok: false, error: "transport-failed" });
    list.mockRejectedValueOnce(new DshAccessError("storage-unavailable"));
    expect(await request({ type: "list" })).toEqual({ ok: false, error: "storage-unavailable" });
  });
  it("invalidates requests queued across navigation and unregisters destroyed windows", async () => {
    const { request, contents, list } = fixture();
    const queued = request({ type: "list" });
    contents.emit("did-start-navigation", {}, "paseo://app/next", false, true);
    expect(await queued).toEqual({ ok: false, error: "request-cancelled" });
    expect(list).not.toHaveBeenCalled();
    expect(await request({ type: "list" })).toEqual({ ok: true, value: [] });
    contents.emit("destroyed");
    expect(await request({ type: "list" })).toEqual({ ok: false, error: "unsupported-platform" });
  });
});
