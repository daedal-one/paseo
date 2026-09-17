import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopDshTransport, type DesktopDshTransport } from "./transport";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
async function host(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
function own(origin: string): DesktopDshTransport {
  const transport = createDesktopDshTransport({ origin, credential: "private-device-grant" });
  cleanup.push(() => transport.dispose());
  return transport;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("desktop authenticated carriers", () => {
  it("preserves structured host refusals for the generated enrollment client", async () => {
    const body = {
      ok: false,
      error: { code: "connection/invalid-enrollment", message: "Refused", details: {} },
    };
    const { origin } = await host((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
    const response = await own(origin).fetch(new URL("/api/connection/devices/claim", origin), {
      method: "POST",
      body: "{}",
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(body);
  });

  it("pins HTTP origin and replaces renderer credentials without forwarding cookies", async () => {
    const headers = deferred<IncomingMessage["headers"]>();
    const { origin } = await host((request, response) => {
      headers.resolve(request.headers);
      response.end('{"ok":true}');
    });
    const transport = own(origin);
    const response = await transport.fetch(new URL("/api/session/list", origin), {
      method: "POST",
      body: "{}",
      headers: {
        authorization: "renderer",
        cookie: "ambient",
        origin: "https://wrong.example",
        "content-type": "application/json",
      },
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(await headers.promise).toMatchObject({
      authorization: "Bearer private-device-grant",
      origin,
      "content-type": "application/json",
    });
    expect((await headers.promise).cookie).toBeUndefined();
    await expect(
      transport.fetch(new URL("https://other.example/api/session/list"), {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({ code: "invalid-origin" });
  });
  it("refuses redirects before another origin can receive credentials", async () => {
    let received = 0;
    const destination = await host((_request, response) => {
      received++;
      response.end("{}");
    });
    const source = await host((_request, response) => {
      response.writeHead(307, { location: destination.origin });
      response.end();
    });
    await expect(
      own(source.origin).fetch(new URL("/rpc", source.origin), { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "transport-failed" });
    expect(received).toBe(0);
  });
  it("keeps cancellation ownership through response decoding", async () => {
    const started = deferred<void>();
    const { origin } = await host((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"pending":');
      started.resolve();
    });
    const transport = own(origin);
    const controller = new AbortController();
    const request = transport.fetch(new URL("/rpc", origin), {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    const rejected = expect(request).rejects.toMatchObject({ code: "request-cancelled" });
    await started.promise;
    controller.abort();
    await rejected;
    await transport.dispose();
  });
  it("authenticates WebSockets and waits for open and connecting sockets to close", async () => {
    const { server, origin } = await host((_request, response) => response.end("{}"));
    const wss = new WebSocketServer({ server });
    cleanup.push(async () => {
      const closed = once(wss, "close");
      for (const peer of wss.clients) peer.terminate();
      wss.close();
      await closed;
    });
    const transport = own(origin);
    const connected = once(wss, "connection");
    const socket = transport.openSocket(origin.replace("http", "ws") + "/api/remote.mux");
    await once(socket, "open");
    const [, request] = await connected;
    expect((request as IncomingMessage).headers.authorization).toBe("Bearer private-device-grant");
    expect((request as IncomingMessage).headers.origin).toBe(origin);
    const connecting = transport.openSocket(origin.replace("http", "ws") + "/api/remote.mux");
    await transport.dispose();
    expect(socket.readyState).toBe(3);
    expect(connecting.readyState).toBe(3);
    expect(() => transport.openSocket(origin.replace("http", "ws"))).toThrow("transport-disposed");
  });
  it("disposal aborts incomplete responses before resolving", async () => {
    const started = deferred<void>();
    const { origin } = await host((_request, response) => {
      response.write("{");
      started.resolve();
    });
    const transport = own(origin);
    const request = transport.fetch(new URL("/rpc", origin), { method: "POST", body: "{}" });
    const rejected = expect(request).rejects.toMatchObject({ code: "request-cancelled" });
    await started.promise;
    await transport.dispose();
    await rejected;
  });
});
