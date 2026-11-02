import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
} from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { CanonicalBodyStaging } from "./body-staging.js";
import { CanonicalCreationStorage } from "./creation-storage.js";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  canonicalRequestSchema,
  canonicalPathAllowed,
  DSH_CANONICAL_ORIGIN,
  DSH_CANONICAL_SCHEME,
  type CanonicalRequest,
  type CanonicalResponse,
} from "@getpaseo/protocol/dsh-canonical";
import type { ConnectionHostId } from "@deepseek-ai/dsh-client";
import { DshAccessError, type StoredDshHost } from "@getpaseo/protocol/dsh-access";
import type { DesktopDshDeviceStore } from "../device-store.js";

interface Owner {
  window: BrowserWindow;
  host: StoredDshHost;
  admission: unknown;
  controllers: Map<string, AbortController>;
  downloads: Map<string, AbortController>;
  staging: CanonicalBodyStaging;
  sockets: Map<string, WebSocket>;
  pending: Set<Promise<unknown>>;
  closed: boolean;
  loaded: boolean;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of [
    "content-type",
    "content-disposition",
    "cache-control",
    "content-range",
    "accept-ranges",
  ]) {
    const value = headers.get(name);
    if (value !== null) result[name] = value;
  }
  return result;
}

/** Isolated remote documents own no Host process and expose no enrollment credentials. */
export class CanonicalDshWindows {
  private readonly owners = new Map<number, Owner>();
  private readonly retiring = new Set<Promise<void>>();
  private readonly openings = new Map<ConnectionHostId, Promise<void>>();
  private readonly epochs = new Map<ConnectionHostId, number>();
  private disposed = false;
  private creationStorage(): CanonicalCreationStorage {
    return new CanonicalCreationStorage(
      join(app.getPath("userData"), "dsh-canonical-creation.sqlite"),
    );
  }
  constructor(private readonly store: DesktopDshDeviceStore) {
    ipcMain.on("daedal:canonical:admission", (event: IpcMainEvent) => {
      event.returnValue = this.sender(event)?.admission ?? null;
    });
    ipcMain.handle(
      "daedal:canonical:request",
      async (event: IpcMainInvokeEvent, value: unknown) => {
        const owner = this.sender(event);
        const parsed = canonicalRequestSchema.safeParse(value);
        if (owner === undefined || !parsed.success) throw new Error("Canonical carrier refused");
        try {
          return await this.track(owner, this.request(owner, parsed.data));
        } catch {
          throw new Error("Canonical carrier request failed");
        }
      },
    );
  }
  private sender(event: IpcMainInvokeEvent | IpcMainEvent): Owner | undefined {
    const owner = this.owners.get(event.sender.id);
    return owner !== undefined &&
      !owner.closed &&
      event.senderFrame === owner.window.webContents.mainFrame &&
      event.senderFrame.origin === DSH_CANONICAL_ORIGIN
      ? owner
      : undefined;
  }
  private track<T>(owner: Owner, task: Promise<T>): Promise<T> {
    owner.pending.add(task);
    void task.then(
      () => owner.pending.delete(task),
      () => owner.pending.delete(task),
    );
    return task;
  }
  open(hostId: ConnectionHostId, legacyCreation?: string | null): Promise<void> {
    if (this.disposed) return Promise.reject(new DshAccessError("transport-disposed"));
    const pending = this.openings.get(hostId);
    if (pending !== undefined) return pending;
    const epoch = this.epochs.get(hostId) ?? 0;
    const opening = this.openWindow(
      hostId,
      () => !this.disposed && (this.epochs.get(hostId) ?? 0) === epoch,
      legacyCreation,
    );
    this.openings.set(hostId, opening);
    const settled = () => {
      if (this.openings.get(hostId) === opening) this.openings.delete(hostId);
    };
    void opening.then(settled, settled);
    return opening;
  }
  private async openWindow(
    hostId: ConnectionHostId,
    current: () => boolean,
    legacyCreation?: string | null,
  ): Promise<void> {
    const existing = [...this.owners.values()].find(
      (owner) => owner.host.grant.hostId === hostId && !owner.closed,
    );
    if (existing !== undefined) {
      existing.window.show();
      existing.window.focus();
      return;
    }
    const host = await this.store.load(hostId);
    if (!current()) throw new DshAccessError("request-cancelled");
    if (host === null) throw new DshAccessError("not-paired");
    if (legacyCreation !== undefined) this.creationStorage().importLegacy(hostId, legacyCreation);
    const resources = join(__dirname, "resources");
    const [bootstrap, capabilitiesText] = await Promise.all([
      readFile(join(resources, "bootstrap.js"), "utf8"),
      readFile(join(resources, "admission.json"), "utf8"),
    ]);
    if (!current()) throw new DshAccessError("request-cancelled");
    const isolated = session.fromPartition(`dsh-canonical-${randomUUID()}`, { cache: false });
    const window = new BrowserWindow({
      title: "Daedal DSH",
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        session: isolated,
        preload: join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const owner: Owner = {
      window,
      host,
      admission: {
        expectedHostId: hostId,
        requiredCapabilities: JSON.parse(capabilitiesText) as unknown,
      },
      controllers: new Map(),
      downloads: new Map(),
      staging: new CanonicalBodyStaging(),
      sockets: new Map(),
      pending: new Set(),
      closed: false,
      loaded: false,
    };
    this.owners.set(window.webContents.id, owner);
    isolated.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    const external = (value: string) => {
      try {
        const url = new URL(value);
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
          void shell.openExternal(url.href).catch(() => {});
      } catch {
        /* Invalid user links have no native destination. */
      }
    };
    window.webContents.setWindowOpenHandler(({ url }) => {
      external(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== `${DSH_CANONICAL_ORIGIN}/index.html` && url !== `${DSH_CANONICAL_ORIGIN}/`) {
        event.preventDefault();
        external(url);
      }
    });
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.webContents.on("render-process-gone", () => this.revoke(owner));
    window.webContents.on("did-start-navigation", (_event, _url, inPage, mainFrame) => {
      if (!owner.loaded || inPage || !mainFrame) return;
      for (const controller of owner.controllers.values()) controller.abort();
      for (const socket of owner.sockets.values()) socket.terminate();
    });
    isolated.protocol.handle(DSH_CANONICAL_SCHEME, async (request) => {
      if (owner.closed) return new Response(null, { status: 410 });
      const url = new URL(request.url);
      if (
        url.protocol !== `${DSH_CANONICAL_SCHEME}:` ||
        url.hostname !== "host" ||
        url.port ||
        url.username ||
        url.password
      )
        return new Response(null, { status: 403 });
      if (url.pathname === "/__dsh_native_bootstrap.js" && request.method === "GET")
        return new Response(bootstrap, {
          headers: { "content-type": "application/javascript", "cache-control": "no-store" },
        });
      try {
        const result = await this.track(
          owner,
          this.fetch(owner, {
            kind: "fetch",
            id: randomUUID(),
            path: url.pathname + url.search,
            method: request.method as "GET",
            headers: {},
            bodyStageId: null,
          }),
        );
        let body = Buffer.from(result.body, "base64");
        if ((url.pathname === "/" || url.pathname === "/index.html") && result.status === 200) {
          if (!body.toString("utf8").includes('<meta name="dsh-canonical-interface" content="1">'))
            throw new Error("Canonical interface unavailable");
          body = Buffer.from(
            body
              .toString("utf8")
              .replace(
                /<head([^>]*)>/i,
                '<head$1><script src="/__dsh_native_bootstrap.js"></script>',
              ),
          );
          delete result.headers["content-length"];
        }
        return new Response(request.method === "HEAD" ? null : body, {
          status: result.status,
          headers: result.headers,
        });
      } catch {
        return new Response("Remote interface unavailable", { status: 502 });
      }
    });
    window.once("closed", () => {
      void this.retire(owner);
    });
    try {
      await window.loadURL(`${DSH_CANONICAL_ORIGIN}/index.html`);
      owner.loaded = true;
      if (!owner.closed && current()) window.show();
      else {
        window.close();
        throw new DshAccessError("request-cancelled");
      }
    } catch {
      window.destroy();
      await this.retire(owner);
      throw new DshAccessError("transport-failed");
    }
  }
  private async fetch(
    owner: Owner,
    request: Extract<CanonicalRequest, { kind: "fetch" }>,
    operation?: AbortController,
  ): Promise<CanonicalResponse> {
    if (
      owner.closed ||
      owner.controllers.has(request.id) ||
      !canonicalPathAllowed(request.path, request.method)
    )
      throw new Error("Request refused");
    if (request.method !== "POST" && request.bodyStageId !== null)
      throw new Error("Read body refused");
    const target = new URL(request.path, owner.host.origin);
    if (target.origin !== new URL(owner.host.origin).origin || target.username || target.password)
      throw new Error("Foreign destination refused");
    const controller = operation ?? new AbortController();
    controller.signal.throwIfAborted();
    const headers = new Headers({
      origin: owner.host.origin,
      authorization: `Bearer ${owner.host.grant.credential}`,
    });
    for (const name of ["accept", "content-type", "range"]) {
      const value = new Headers(request.headers).get(name);
      if (value !== null) headers.set(name, value);
    }
    const staged =
      request.bodyStageId === null ? undefined : owner.staging.take(request.bodyStageId);
    const source = staged === undefined ? undefined : createReadStream(staged.path());
    const body =
      source === undefined ? undefined : (Readable.toWeb(source) as ReadableStream<Uint8Array>);
    owner.controllers.set(request.id, controller);
    try {
      const init = {
        method: request.method,
        headers,
        body,
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        duplex: "half",
      } satisfies RequestInit & { duplex: string };
      const response = await fetch(target, init);
      if (response.status === 401 || response.status === 403) {
        // Revocation ends native authority; a later explicit open must reread protected storage.
        this.revoke(owner);
        throw new Error("Access refused");
      }
      const bytes = await response.arrayBuffer();
      controller.signal.throwIfAborted();
      return {
        status: response.status,
        headers: responseHeaders(response.headers),
        body: Buffer.from(bytes).toString("base64"),
      };
    } finally {
      source?.destroy();
      await staged?.dispose();
      owner.controllers.delete(request.id);
    }
  }
  private async request(owner: Owner, request: CanonicalRequest): Promise<unknown> {
    switch (request.kind) {
      case "creation-read":
        return this.creationStorage().read(owner.host.grant.hostId);
      case "creation-cas":
        return this.creationStorage().compareExchange(
          owner.host.grant.hostId,
          request.before,
          request.after,
        );
      case "body-open":
        return owner.staging.open(request.id);
      case "body-write":
        return owner.staging.write(request.id, request.sequence, request.data);
      case "body-seal":
        return owner.staging.seal(request.id);
      case "body-discard":
        return owner.staging.discard(request.id);
      case "fetch":
        return this.fetch(owner, request);
      case "abort":
        owner.controllers.get(request.id)?.abort();
        owner.downloads.get(request.id)?.abort();
        return null;
      case "socket-open": {
        if (owner.sockets.has(request.id)) throw new Error("Duplicate socket");
        const socket = new WebSocket(owner.host.origin.replace(/^http/, "ws") + "/api/remote.mux", {
          headers: {
            origin: owner.host.origin,
            authorization: `Bearer ${owner.host.grant.credential}`,
          },
          followRedirects: false,
        });
        owner.sockets.set(request.id, socket);
        const emit = (type: "open" | "error" | "close" | "message", data?: string) => {
          if (!owner.closed && !owner.window.isDestroyed())
            owner.window.webContents.send("daedal:canonical:socket", {
              id: request.id,
              type,
              ...(data === undefined ? {} : { data }),
            });
        };
        socket.on("unexpected-response", (_request, response) => {
          response.resume();
          socket.terminate();
          if (response.statusCode === 401 || response.statusCode === 403) this.revoke(owner);
          else emit("error");
        });
        socket.on("open", () => emit("open"));
        socket.on("error", () => emit("error"));
        socket.on("message", (data) => emit("message", data.toString()));
        socket.on("close", () => {
          owner.sockets.delete(request.id);
          emit("close");
        });
        return null;
      }
      case "socket-send": {
        const socket = owner.sockets.get(request.id);
        if (socket?.readyState !== WebSocket.OPEN) throw new Error("Socket unavailable");
        socket.send(request.data);
        return null;
      }
      case "socket-close":
        owner.sockets.get(request.id)?.terminate();
        return null;
      case "download":
        return this.download(owner, request);
    }
  }
  private async download(
    owner: Owner,
    request: Extract<CanonicalRequest, { kind: "download" }>,
  ): Promise<null> {
    if (
      !request.path.startsWith("/api/session.export?") ||
      !canonicalPathAllowed(request.path, "GET")
    )
      throw new Error("Download refused");
    if (owner.downloads.has(request.id)) throw new Error("Duplicate export");
    const operation = new AbortController();
    owner.downloads.set(request.id, operation);
    try {
      const filename = Array.from(basename(request.filename), (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? "_" : character,
      ).join("");
      const result = await dialog.showSaveDialog(owner.window, {
        defaultPath: filename || "dsh-session.zip",
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      operation.signal.throwIfAborted();
      if (result.canceled || result.filePath === undefined || owner.closed)
        throw new Error("Export cancelled");
      const response = await this.fetch(
        owner,
        {
          kind: "fetch",
          id: request.id,
          path: request.path,
          method: "GET",
          headers: {},
          bodyStageId: null,
        },
        operation,
      );
      if (
        response.status !== 200 ||
        !response.headers["content-type"]?.startsWith("application/zip")
      )
        throw new Error("Export unavailable");
      operation.signal.throwIfAborted();
      await writeFile(result.filePath, Buffer.from(response.body, "base64"), {
        mode: 0o600,
        signal: operation.signal,
      });
      return null;
    } finally {
      owner.downloads.delete(request.id);
    }
  }
  private revoke(owner: Owner): void {
    void this.retire(owner);
    if (!owner.window.isDestroyed()) owner.window.destroy();
  }
  private retire(owner: Owner): Promise<void> {
    if (owner.closed) return Promise.resolve();
    owner.closed = true;
    this.owners.delete(owner.window.webContents.id);
    for (const controller of owner.controllers.values()) controller.abort();
    for (const controller of owner.downloads.values()) controller.abort();
    const sockets = [...owner.sockets.values()].map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) resolve();
          else {
            socket.once("close", resolve);
            socket.terminate();
          }
        }),
    );
    const closing = Promise.allSettled([
      ...owner.pending,
      ...sockets,
      owner.staging.dispose(),
    ]).then(() => undefined);
    this.retiring.add(closing);
    void closing.then(() => this.retiring.delete(closing));
    return closing;
  }
  async forget(hostId: ConnectionHostId): Promise<void> {
    this.epochs.set(hostId, (this.epochs.get(hostId) ?? 0) + 1);
    const owners = [...this.owners.values()].filter((owner) => owner.host.grant.hostId === hostId);
    for (const owner of owners) owner.window.close();
    await Promise.allSettled([
      ...owners.map((owner) => this.retire(owner)),
      ...this.retiring,
      this.openings.get(hostId),
    ]);
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    ipcMain.removeHandler("daedal:canonical:request");
    ipcMain.removeAllListeners("daedal:canonical:admission");
    for (const owner of this.owners.values()) {
      owner.window.close();
      void this.retire(owner);
    }
    await Promise.allSettled([...this.retiring, ...this.openings.values()]);
  }
}
