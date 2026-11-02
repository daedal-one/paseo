import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConnectionHostId } from "@deepseek-ai/dsh-client";
import type { DesktopDshDeviceStore } from "../device-store";
import { CanonicalDshWindows } from "./windows";

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  events: new Map<string, (...args: unknown[]) => unknown>(),
  routes: [] as ((request: Request) => Promise<Response>)[],
  windows: [] as TestWindow[],
  save: vi.fn(),
  write: vi.fn(),
  getPath: vi.fn(),
}));
class TestWindow extends EventEmitter {
  static count = 0;
  closed = false;
  webContents = {
    id: ++TestWindow.count,
    mainFrame: { origin: "dshremote://host" },
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  };
  constructor() {
    super();
    native.windows.push(this);
  }
  show = vi.fn();
  focus = vi.fn();
  loadURL = vi.fn().mockResolvedValue(undefined);
  close() {
    if (!this.closed) {
      this.closed = true;
      this.emit("closed");
    }
  }
  destroy() {
    this.close();
  }
  isDestroyed() {
    return this.closed;
  }
}
vi.mock("electron", () => ({
  app: { getPath: native.getPath },
  BrowserWindow: function () {
    return new TestWindow();
  },
  dialog: { showSaveDialog: native.save },
  shell: { openExternal: vi.fn() },
  ipcMain: {
    handle: (key: string, handler: (...args: unknown[]) => unknown) =>
      native.handlers.set(key, handler),
    on: (key: string, handler: (...args: unknown[]) => unknown) => native.events.set(key, handler),
    removeHandler: (key: string) => native.handlers.delete(key),
    removeAllListeners: (key: string) => native.events.delete(key),
  },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: vi.fn(),
      protocol: {
        handle: (_scheme: string, handler: (request: Request) => Promise<Response>) =>
          native.routes.push(handler),
      },
    }),
  },
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  writeFile: native.write,
  readFile: (path: string) =>
    Promise.resolve(path.endsWith("admission.json") ? "[]" : "globalThis.fixture=true"),
}));
const hostId = "b1b841e9-e232-4979-9a15-d0398c84528d" as ConnectionHostId;
const managers: CanonicalDshWindows[] = [];
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  native.handlers.clear();
  native.events.clear();
  native.routes.length = 0;
  native.windows.length = 0;
  native.save.mockReset();
  native.write.mockReset();
  native.getPath.mockReset();
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()));
  vi.unstubAllGlobals();
});
async function fixture() {
  const store = {
    load: vi.fn().mockResolvedValue({
      version: 1,
      origin: "https://pinned.example",
      grant: { hostId, credential: "protected-bearer" },
    }),
  };
  const manager = new CanonicalDshWindows(store as unknown as DesktopDshDeviceStore);
  managers.push(manager);
  await manager.open(hostId);
  const window = native.windows[0]!;
  const invoke = (input: unknown, frame = window.webContents.mainFrame) =>
    Promise.resolve(
      native.handlers.get("daedal:canonical:request")!(
        { sender: window.webContents, senderFrame: frame },
        input,
      ),
    );
  return { manager, window, invoke, store };
}
const request = {
  kind: "fetch",
  id: "61d81db7-8767-4cf4-acdc-6bd1213a7a7c",
  path: "/api/session/prompt",
  method: "POST",
  headers: { authorization: "injected", cookie: "injected", "content-type": "application/json" },
  bodyStageId: null,
};
it("keeps durable receipt CAS scoped to the native window Host and rejects stale frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canonical-ipc-journal-"));
  native.getPath.mockReturnValue(directory);
  try {
    const f = await fixture();
    const read = { kind: "creation-read", id: request.id };
    const claim = { kind: "creation-cas", id: request.id, before: null, after: "pending" };
    expect(await f.invoke(read)).toBeNull();
    expect(await f.invoke(claim)).toBe(true);
    expect(await f.invoke(claim)).toBe(false);
    expect(await f.invoke(read)).toBe("pending");
    await expect(f.invoke({ ...read, hostId: "foreign" })).rejects.toThrow("refused");
    await expect(f.invoke(read, { origin: "dshremote://host" })).rejects.toThrow("refused");
    const retained = native.handlers.get("daedal:canonical:request")!;
    await f.manager.dispose();
    await expect(
      retained({ sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame }, read),
    ).rejects.toThrow("refused");
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("adds credentials only in main, strips renderer headers, and refuses foreign frames and paths", async () => {
  const f = await fixture();
  fetcher.mockResolvedValue(
    new Response("{}", {
      headers: { "content-type": "application/json", "set-cookie": "private" },
    }),
  );
  const reply = await f.invoke(request);
  expect(fetcher).toHaveBeenCalledOnce();
  const [target, init] = fetcher.mock.calls[0]!;
  expect(String(target)).toBe("https://pinned.example/api/session/prompt");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer protected-bearer");
  expect(new Headers(init?.headers).get("cookie")).toBeNull();
  expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
  expect(reply).toEqual({
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from("{}").toString("base64"),
  });
  await expect(f.invoke(request, { origin: "dshremote://host" })).rejects.toThrow("refused");
  await expect(
    f.invoke({ ...request, path: "https://foreign.example/api/session/prompt" }),
  ).rejects.toThrow("failed");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("qualifies canonical HTML before bootstrap injection and never shows an unmarked graph", async () => {
  await fixture();
  const route = native.routes[0]!;
  fetcher.mockResolvedValueOnce(new Response("<html><head></head>Legacy</html>"));
  expect((await route(new Request("dshremote://host/index.html"))).status).toBe(502);
  fetcher.mockResolvedValueOnce(
    new Response('<html><head><meta name="dsh-canonical-interface" content="1"></head></html>'),
  );
  const response = await route(new Request("dshremote://host/index.html"));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(
    '<head><script src="/__dsh_native_bootstrap.js"></script>',
  );
});
it("cancels and joins a disposed request without replay or late success", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<AbortSignal>();
  const response = Promise.withResolvers<Response>();
  fetcher.mockImplementation((_input, init) => {
    entered.resolve(init!.signal!);
    return response.promise;
  });
  const pending = f.invoke(request);
  const signal = await entered.promise;
  let done = false;
  const closing = f.manager.dispose().then(() => {
    done = true;
    return undefined;
  });
  expect(signal.aborted).toBe(true);
  await Promise.resolve();
  expect(done).toBe(false);
  response.resolve(new Response("{}"));
  await expect(pending).rejects.toThrow("failed");
  await closing;
  expect(done).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
});
it("closes native authority when credentials are refused", async () => {
  const f = await fixture();
  fetcher.mockResolvedValue(new Response(null, { status: 401 }));
  await expect(f.invoke(request)).rejects.toThrow("failed");
  expect(f.window.closed).toBe(true);
  await expect(f.invoke(request)).rejects.toThrow("refused");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("requires an explicit save destination and a ZIP response for exports", async () => {
  const f = await fixture();
  native.save.mockResolvedValue({ canceled: false, filePath: "/chosen/export.zip" });
  fetcher.mockResolvedValue(
    new Response("zip bytes", { headers: { "content-type": "application/zip" } }),
  );
  await f.invoke({
    kind: "download",
    id: request.id,
    path: "/api/session.export?sessionId=session-one",
    filename: "session-one.zip",
  });
  expect(native.write).toHaveBeenCalledExactlyOnceWith(
    "/chosen/export.zip",
    Buffer.from("zip bytes"),
    expect.objectContaining({ mode: 0o600, signal: expect.any(AbortSignal) }),
  );
});

it("coalesces opening a Host and refuses pending admission after disposal", async () => {
  const read = Promise.withResolvers<unknown>();
  const store = { load: vi.fn().mockReturnValue(read.promise) };
  const manager = new CanonicalDshWindows(store as unknown as DesktopDshDeviceStore);
  managers.push(manager);
  const first = manager.open(hostId);
  expect(manager.open(hostId)).toBe(first);
  let retired = false;
  const closing = manager.dispose().then(() => {
    retired = true;
    return undefined;
  });
  await Promise.resolve();
  expect(retired).toBe(false);
  read.resolve({
    version: 1,
    origin: "https://pinned.example",
    grant: { hostId, credential: "protected-bearer" },
  });
  await expect(first).rejects.toThrow("request-cancelled");
  await closing;
  expect(native.windows).toHaveLength(0);
  expect(store.load).toHaveBeenCalledOnce();
});
it("forgetting a Host invalidates a pending open before window admission", async () => {
  const read = Promise.withResolvers<unknown>();
  const manager = new CanonicalDshWindows({
    load: vi.fn().mockReturnValue(read.promise),
  } as unknown as DesktopDshDeviceStore);
  managers.push(manager);
  const pending = manager.open(hostId);
  const forgetting = manager.forget(hostId);
  read.resolve({
    version: 1,
    origin: "https://pinned.example",
    grant: { hostId, credential: "protected-bearer" },
  });
  await expect(pending).rejects.toThrow("request-cancelled");
  await forgetting;
  expect(native.windows).toHaveLength(0);
});

it("never attaches native authority to a URL parser origin escape", async () => {
  const f = await fixture();
  for (const path of [
    "/\n/evil.example/assets/x.js",
    "/\t/evil.example/assets/x.js",
    "/\r/evil.example/assets/x.js",
  ]) {
    await expect(f.invoke({ ...request, method: "GET", bodyStageId: null, path })).rejects.toThrow(
      "failed",
    );
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("forwards live plugin namespaces and returns Host refusals without replay", async () => {
  const f = await fixture();
  fetcher.mockImplementation(
    async () => new Response('{"ok":false,"error":{"code":"gateway/not-found"}}', { status: 404 }),
  );
  for (const path of [
    "/api/agentTeams/view",
    "/api/agentTeams/createTask",
    "/api/agentTeams/updateTask",
    "/api/operatorPlugin/newMethod",
  ]) {
    const result = await f.invoke({ ...request, path });
    expect(result).toMatchObject({ status: 404 });
  }
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("streams a sealed body once and never reuses its staging authority", async () => {
  const f = await fixture();
  const stageId = "a0e0a7eb-3fdd-4e62-9525-928602ed3871";
  await f.invoke({ kind: "body-open", id: stageId });
  await f.invoke({
    kind: "body-write",
    id: stageId,
    sequence: 0,
    data: Buffer.from("first").toString("base64"),
  });
  await f.invoke({
    kind: "body-write",
    id: stageId,
    sequence: 1,
    data: Buffer.from("second").toString("base64"),
  });
  await f.invoke({ kind: "body-seal", id: stageId });
  let received = "";
  fetcher.mockImplementation(async (_url, init) => {
    received = await new Response(init?.body).text();
    return new Response("{}");
  });
  await f.invoke({ ...request, bodyStageId: stageId });
  expect(received).toBe("firstsecond");
  await expect(f.invoke({ ...request, bodyStageId: stageId })).rejects.toThrow("failed");
  expect(fetcher).toHaveBeenCalledOnce();
});
