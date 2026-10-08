import { describe, expect, it, vi } from "vitest";
import {
  selectRemoteCapabilities,
  type SessionId,
  type SessionTerminalFrame,
} from "@deepseek-ai/dsh-client";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { DshHostRuntime } from "./runtime";
import { DshTerminal } from "./terminal";
function fixture(frames: SessionTerminalFrame[] = []) {
  let generation: object | undefined = {};
  const listeners = new Set<() => void>();
  const finished = vi.fn();
  const terminal = vi.fn(async function* (_request: unknown, signal: AbortSignal) {
    try {
      yield { kind: "ready", maxInputBytes: 8 } as SessionTerminalFrame;
      for (const frame of frames) yield frame;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      finished();
    }
  });
  const input = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const runtime = {
    connection: {
      generation: {
        getSnapshot: () => generation,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
    remote: {
      $host: {
        capabilities: {
          capabilities: selectRemoteCapabilities([
            "session/terminal",
            "session/terminalInput",
            "session/terminalResize",
          ]).map((row) => Object.assign({}, row, { availability: "available" })),
        },
      },
      session: {
        terminal,
        terminalInput: input,
        terminalResize: vi.fn(async () => ({ ok: true, value: undefined })),
      },
    },
  } as unknown as DshHostRuntime;
  const model = new DshTerminal(runtime, brandString<SessionId>("session"), () => "terminal-id");
  return {
    model,
    terminal,
    input,
    finished,
    disconnect() {
      generation = undefined;
      for (const listener of listeners) listener();
    },
  };
}
describe("DSH terminal lifecycle", () => {
  it("closes the physical stream on generation loss without opening another shell or replaying input", async () => {
    const f = fixture();
    f.model.start(24, 80);
    await vi.waitFor(() => expect(f.model.getSnapshot().status).toBe("open"));
    f.model.input("echo hello\n");
    await vi.waitFor(() => expect(f.input).toHaveBeenCalled());
    f.disconnect();
    await f.model.dispose();
    expect(f.terminal).toHaveBeenCalledOnce();
    expect(f.finished).toHaveBeenCalledOnce();
    expect(f.model.getSnapshot().status).toBe("closed");
  });
  it("splits unicode input within the advertised byte limit and retains bounded output", async () => {
    const f = fixture([{ kind: "output", data: "x".repeat(150_000) }]);
    f.model.start(24, 80);
    await vi.waitFor(() => expect(f.model.getSnapshot().text.length).toBe(128_000));
    f.model.input("🐈éhello");
    await vi.waitFor(() => expect(f.input.mock.calls.length).toBe(4));
    const chunks = f.input.mock.calls.map(
      (args) => (args as unknown as [{ data: string }])[0].data,
    );
    expect(chunks.join("")).toBe("🐈éhello");
    expect(chunks.every((text) => new TextEncoder().encode(text).length <= 8)).toBe(true);
    await f.model.dispose();
  });
  it("stops after an uncertain input failure and does not send queued input", async () => {
    const f = fixture();
    f.input.mockRejectedValueOnce(new Error("carrier lost"));
    f.model.start(24, 80);
    await vi.waitFor(() => expect(f.model.getSnapshot().status).toBe("open"));
    f.model.input("a");
    f.model.input("b");
    await vi.waitFor(() => expect(f.model.getSnapshot().status).toBe("failed"));
    await f.model.dispose();
    expect(f.input).toHaveBeenCalledOnce();
  });
});
