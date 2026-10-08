import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserDshTransport } from "./transport";

class Socket extends EventTarget {
  static instances: Socket[] = [];
  readonly readyState = 1;
  send = vi.fn();
  close = vi.fn(() => this.dispatchEvent(new Event("close")));
  constructor(readonly url: string) {
    super();
    Socket.instances.push(this);
  }
}

const fetch = vi.fn<typeof window.fetch>();
beforeEach(() => {
  fetch.mockReset();
  Socket.instances = [];
  vi.stubGlobal("window", { location: { href: "https://host.example/daedal/dsh-hosts" }, fetch });
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => vi.unstubAllGlobals());

describe("browser DSH transport", () => {
  it("uses the page owner session without accepting injected authentication", async () => {
    fetch.mockResolvedValue(Response.json({ session: "existing" }));
    const transport = createBrowserDshTransport();
    const reply = await transport.fetch(new URL("https://host.example/api"), {
      method: "POST",
      headers: {
        authorization: "Bearer foreign",
        cookie: "foreign",
        origin: "https://other.example",
        "content-type": "application/json",
      },
      credentials: "omit",
      redirect: "follow",
    });
    expect(await reply.json()).toEqual({ session: "existing" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://host.example/api");
    expect(init).toMatchObject({
      credentials: "same-origin",
      redirect: "error",
      mode: "same-origin",
    });
    const headers = new Headers(init?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("origin")).toBe(false);
    expect(headers.get("content-type")).toBe("application/json");
    transport.dispose();
  });

  it.each([
    "https://other.example/api",
    "http://host.example/api",
    "https://host.example:8443/api",
    "https://credential@host.example/api",
    "https://host.example/api#secret",
  ])("refuses HTTP outside the selected page authority: %s", async (url) => {
    const transport = createBrowserDshTransport();
    await expect(transport.fetch(new URL(url), {})).rejects.toMatchObject({
      code: "invalid-origin",
    });
    expect(fetch).not.toHaveBeenCalled();
    transport.dispose();
  });

  it("pins sockets and closes them when their owner is disposed", () => {
    const transport = createBrowserDshTransport();
    expect(() => transport.createSocket("wss://other.example/api/remote.mux")).toThrow(
      "invalid-origin",
    );
    expect(() => transport.createSocket("ws://host.example/api/remote.mux")).toThrow(
      "invalid-origin",
    );
    expect(() => transport.createSocket("wss://credential@host.example/api/remote.mux")).toThrow(
      "invalid-origin",
    );
    expect(() => transport.createSocket("not a URL")).toThrow("invalid-origin");
    const socket = transport.createSocket("wss://host.example/api/remote.mux");
    const listener = vi.fn();
    socket.addEventListener("message", listener);
    Socket.instances[0]!.dispatchEvent(new MessageEvent("message", { data: "event" }));
    expect(listener).toHaveBeenCalledOnce();
    socket.send("request");
    expect(Socket.instances[0]!.send).toHaveBeenCalledWith("request");
    transport.dispose();
    transport.dispose();
    expect(Socket.instances[0]!.close).toHaveBeenCalledOnce();
    expect(() => transport.createSocket("wss://host.example/api/remote.mux")).toThrow(
      "transport-disposed",
    );
  });

  it.each(["caller", "owner"])(
    "keeps %s cancellation active while decoding JSON",
    async (source) => {
      const caller = new AbortController();
      let finish!: (value: unknown) => void;
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => {
          started();
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      } as Response);
      const transport = createBrowserDshTransport();
      const pending = transport.fetch(new URL("https://host.example/api"), {
        signal: caller.signal,
      });
      const checked = expect(pending).rejects.toMatchObject({ code: "request-cancelled" });
      await reading;
      if (source === "caller") caller.abort();
      else transport.dispose();
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
      finish({ value: "late response" });
      await checked;
      transport.dispose();
    },
  );

  it("does not dispatch a cancelled operation and redacts transport errors", async () => {
    const transport = createBrowserDshTransport();
    const controller = new AbortController();
    controller.abort();
    await expect(
      transport.fetch(new URL("https://host.example/api"), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "request-cancelled" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValue(new Error("secret cookie in native error"));
    await expect(transport.fetch(new URL("https://host.example/api"), {})).rejects.toThrow(
      "dsh-access/transport-failed",
    );
    transport.dispose();
  });

  it("identifies an expired browser login without reading an HTML error page", async () => {
    const response = new Response("<html>Sign in</html>", { status: 401 });
    fetch.mockResolvedValue(response);
    const transport = createBrowserDshTransport();
    await expect(transport.fetch(new URL("https://host.example/api"), {})).rejects.toMatchObject({
      code: "browser-auth-required",
    });
    expect(response.bodyUsed).toBe(true);
    transport.dispose();
  });

  it("refuses shell and file origins before network access", () => {
    vi.stubGlobal("window", { location: { href: "paseo://app/dsh-hosts" }, fetch });
    expect(createBrowserDshTransport).toThrow("unsupported-platform");
    expect(fetch).not.toHaveBeenCalled();
  });
});
