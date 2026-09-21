import {
  claimDeviceEnrollment,
  HOST_DISCOVERY_ENDPOINT,
  selectRemoteCapabilities,
  type ConnectionHostId,
} from "@deepseek-ai/dsh-client";
import {
  DshAccessError,
  parseDshPairing,
  dshSessionEndpoints,
  dshHistoryEndpoints,
  dshCreationEndpoints,
  dshRegistrationEndpoints,
  type DesktopDshCommand,
  type DesktopDshSocketEvent,
  type DesktopDshHost,
} from "@getpaseo/protocol/dsh-access";
import type { WebSocket } from "ws";
import type { DesktopDshDeviceStore } from "./device-store.js";
import { createDesktopDshTransport, type DesktopDshTransport } from "./transport.js";

// Device enrollment has a separate main-process operation; its grant response cannot
// be obtained through the renderer's ordinary generated-RPC carrier.
const rpcPaths = new Set([
  ...selectRemoteCapabilities([
    ...dshSessionEndpoints,
    ...dshHistoryEndpoints,
    ...dshCreationEndpoints,
    ...dshRegistrationEndpoints,
  ]).map(({ endpoint }) => `/api/${endpoint}`),
  "/api/connection/identity",
  `/api/${HOST_DISCOVERY_ENDPOINT}`,
  "/api/$capabilities",
  "/api/$events/result",
]);
function rpcTarget(value: string, socket = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DshAccessError("invalid-origin");
  }
  if (
    url.search !== "" ||
    (socket ? url.pathname !== "/api/remote.mux" : !rpcPaths.has(url.pathname))
  )
    throw new DshAccessError("invalid-origin");
  return url;
}

interface SocketOwner {
  closed: boolean;
  socket?: WebSocket;
}
interface HostOwner {
  windowId: number;
  hostId: ConnectionHostId;
  closed: boolean;
  ready: Promise<DesktopDshTransport>;
  requests: Map<string, AbortController>;
  sockets: Map<string, SocketOwner>;
  closing?: Promise<void>;
}
interface ClaimOwner {
  hostId: ConnectionHostId;
  windowId: number;
  controller: AbortController;
  done: Promise<DesktopDshHost>;
}

/** Coordinates protected access across trusted app windows. It never owns a DSH process. */
export class DesktopDshAccess {
  private readonly owners = new Map<string, HostOwner>();
  private readonly claims = new Map<string, ClaimOwner>();
  private readonly forgetting = new Set<ConnectionHostId>();
  private pendingClaim: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: Pick<DesktopDshDeviceStore, "load" | "save" | "forget" | "list">,
    private readonly emit: (windowId: number, event: DesktopDshSocketEvent) => void,
  ) {}

  private owner(windowId: number, id: string): HostOwner {
    const owner = this.owners.get(id);
    if (owner === undefined || owner.windowId !== windowId || owner.closed)
      throw new DshAccessError("transport-disposed");
    return owner;
  }

  private async closeOwner(id: string, owner: HostOwner): Promise<void> {
    if (owner.closing !== undefined) return owner.closing;
    owner.closed = true;
    for (const request of owner.requests.values()) request.abort();
    for (const socket of owner.sockets.values()) socket.closed = true;
    owner.closing = (async () => {
      let transport: DesktopDshTransport;
      try {
        transport = await owner.ready;
      } catch {
        return;
      }
      await transport.dispose();
    })().finally(() => {
      if (this.owners.get(id) === owner) this.owners.delete(id);
    });
    return owner.closing;
  }

  private pair(
    windowId: number,
    command: Extract<DesktopDshCommand, { type: "pair" }>,
  ): Promise<DesktopDshHost> {
    if (this.claims.has(command.claimId)) throw new DshAccessError("invalid-enrollment");
    const pairing = parseDshPairing(command.pairing);
    if (this.forgetting.has(pairing.enrollment.hostId)) throw new DshAccessError("not-paired");
    const controller = new AbortController();
    const done = this.pendingClaim.then(async () => {
      if (controller.signal.aborted) throw new DshAccessError("request-cancelled");
      if (await this.store.load(pairing.enrollment.hostId))
        throw new DshAccessError("already-paired");
      if (controller.signal.aborted) throw new DshAccessError("request-cancelled");
      const transport = createDesktopDshTransport({ origin: pairing.origin, credential: null });
      let result: Awaited<ReturnType<typeof claimDeviceEnrollment>>;
      try {
        result = await claimDeviceEnrollment({
          baseUrl: pairing.origin,
          expectedHostId: pairing.enrollment.hostId,
          challenge: pairing.enrollment.challenge,
          label: command.label,
          signal: controller.signal,
          fetch: transport.fetch,
        });
      } catch {
        throw new DshAccessError("enrollment-outcome-unknown");
      } finally {
        await transport.dispose();
      }
      if (!result.ok) {
        const unknown =
          result.error.code === "connection/invalid-enrollment-response" ||
          result.error.code === "connection/enrollment-host-mismatch";
        throw new DshAccessError(unknown ? "enrollment-outcome-unknown" : "enrollment-rejected");
      }
      try {
        await this.store.save({ version: 1, origin: pairing.origin, grant: result.value });
      } catch {
        throw new DshAccessError("enrollment-save-failed");
      }
      return {
        hostId: result.value.hostId,
        origin: pairing.origin,
        label: result.value.device.label,
      };
    });
    this.claims.set(command.claimId, {
      hostId: pairing.enrollment.hostId,
      windowId,
      controller,
      done,
    });
    this.pendingClaim = done.then(
      () => undefined,
      () => undefined,
    );
    const cleanup = () => {
      this.claims.delete(command.claimId);
    };
    void done.then(cleanup, cleanup);
    return done;
  }

  private async forgetHost(
    command: Extract<DesktopDshCommand, { type: "forget" }>,
  ): Promise<unknown> {
    if (this.forgetting.has(command.hostId)) throw new DshAccessError("not-paired");
    this.forgetting.add(command.hostId);
    try {
      const claims = [...this.claims.values()].filter((claim) => claim.hostId === command.hostId);
      for (const claim of claims) claim.controller.abort();
      await Promise.allSettled(claims.map((claim) => claim.done));
      await Promise.all(
        [...this.owners]
          .filter(([, owner]) => owner.hostId === command.hostId)
          .map(([id, owner]) => this.closeOwner(id, owner)),
      );
      await this.store.forget(command.hostId);
      return;
    } finally {
      this.forgetting.delete(command.hostId);
    }
  }

  private async openHost(
    windowId: number,
    command: Extract<DesktopDshCommand, { type: "open" }>,
  ): Promise<unknown> {
    if (this.forgetting.has(command.hostId)) throw new DshAccessError("not-paired");
    if (this.owners.has(command.ownerId)) throw new DshAccessError("invalid-response");
    const ready = this.store.load(command.hostId).then((record) => {
      if (record === null) throw new DshAccessError("not-paired");
      if (owner.closed) throw new DshAccessError("request-cancelled");
      return createDesktopDshTransport({
        origin: record.origin,
        credential: record.grant.credential,
      });
    });
    const owner: HostOwner = {
      windowId,
      hostId: command.hostId,
      closed: false,
      ready,
      requests: new Map(),
      sockets: new Map(),
    };
    this.owners.set(command.ownerId, owner);
    try {
      const transport = await ready;
      if (owner.closed) throw new DshAccessError("request-cancelled");
      return { hostId: command.hostId, origin: transport.origin, label: "" };
    } catch (error) {
      await this.closeOwner(command.ownerId, owner);
      throw error;
    }
  }

  private async fetchHost(
    windowId: number,
    command: Extract<DesktopDshCommand, { type: "fetch" }>,
  ): Promise<unknown> {
    const owner = this.owner(windowId, command.ownerId);
    if (owner.requests.has(command.requestId)) throw new DshAccessError("invalid-response");
    const controller = new AbortController();
    owner.requests.set(command.requestId, controller);
    try {
      const transport = await owner.ready;
      const response = await transport.fetch(rpcTarget(command.url), {
        method: command.method,
        body: command.body,
        headers: command.headers,
        signal: controller.signal,
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    } finally {
      owner.requests.delete(command.requestId);
    }
  }

  private async openSocket(
    windowId: number,
    command: Extract<DesktopDshCommand, { type: "socket-open" }>,
  ): Promise<unknown> {
    const owner = this.owner(windowId, command.ownerId);
    if (owner.sockets.has(command.socketId)) throw new DshAccessError("invalid-response");
    const entry: SocketOwner = { closed: false };
    owner.sockets.set(command.socketId, entry);
    const transport = await owner.ready;
    if (entry.closed || owner.closed) return;
    let socket: WebSocket;
    try {
      socket = transport.openSocket(rpcTarget(command.url, true).href);
    } catch (error) {
      owner.sockets.delete(command.socketId);
      throw error;
    }
    entry.socket = socket;
    const send = (event: DesktopDshSocketEvent) => {
      if (!owner.closed && !entry.closed) this.emit(windowId, event);
    };
    const ids = { ownerId: command.ownerId, socketId: command.socketId };
    socket.on("open", () => send({ ...ids, type: "open" }));
    socket.on("message", (data, binary) => {
      if (binary) {
        send({ ...ids, type: "error" });
        socket.terminate();
      } else send({ ...ids, type: "message", data: data.toString() });
    });
    socket.on("error", () => send({ ...ids, type: "error" }));
    socket.on("close", () => {
      send({ ...ids, type: "close" });
      entry.closed = true;
      owner.sockets.delete(command.socketId);
    });
    return;
  }

  private async sendSocket(
    windowId: number,
    command: Extract<DesktopDshCommand, { type: "socket-send" }>,
  ): Promise<unknown> {
    const socket = this.owner(windowId, command.ownerId).sockets.get(command.socketId);
    if (socket?.closed !== false || socket.socket?.readyState !== 1)
      throw new DshAccessError("transport-failed");
    socket.socket.send(command.data);
    return;
  }

  private async closeSocket(
    windowId: number,
    command: Extract<DesktopDshCommand, { type: "socket-close" }>,
  ): Promise<unknown> {
    const owner = this.owner(windowId, command.ownerId);
    const entry = owner.sockets.get(command.socketId);
    if (entry === undefined) return;
    entry.closed = true;
    if (entry.socket?.readyState === 0) entry.socket.terminate();
    else entry.socket?.close(command.code, command.reason);
    owner.sockets.delete(command.socketId);
    this.emit(windowId, {
      ownerId: command.ownerId,
      socketId: command.socketId,
      type: "close",
    });
    return;
  }

  async run(windowId: number, command: DesktopDshCommand): Promise<unknown> {
    switch (command.type) {
      case "list":
        return this.store.list();
      case "pair":
        return this.pair(windowId, command);
      case "cancel-pair": {
        const claim = this.claims.get(command.claimId);
        if (claim !== undefined && claim.windowId !== windowId)
          throw new DshAccessError("invalid-response");
        claim?.controller.abort();
        return;
      }
      case "forget":
        return this.forgetHost(command);
      case "open":
        return this.openHost(windowId, command);
      case "close": {
        const owner = this.owners.get(command.ownerId);
        if (owner === undefined) return;
        if (owner.windowId !== windowId) throw new DshAccessError("invalid-response");
        return this.closeOwner(command.ownerId, owner);
      }
      case "fetch":
        return this.fetchHost(windowId, command);
      case "abort": {
        this.owner(windowId, command.ownerId).requests.get(command.requestId)?.abort();
        return;
      }
      case "socket-open":
        return this.openSocket(windowId, command);
      case "socket-send":
        return this.sendSocket(windowId, command);
      case "socket-close":
        return this.closeSocket(windowId, command);
    }
  }

  async closeWindow(windowId: number): Promise<void> {
    const claims = [...this.claims.values()].filter((claim) => claim.windowId === windowId);
    for (const claim of claims) claim.controller.abort();
    await Promise.all([
      ...[...this.owners]
        .filter(([, owner]) => owner.windowId === windowId)
        .map(([id, owner]) => this.closeOwner(id, owner)),
      ...claims.map((claim) =>
        claim.done.then(
          () => undefined,
          () => undefined,
        ),
      ),
    ]);
  }

  async dispose(): Promise<void> {
    const windows = new Set(
      [...this.owners.values(), ...this.claims.values()].map((owner) => owner.windowId),
    );
    await Promise.all([...windows].map((id) => this.closeWindow(id)));
  }
}
