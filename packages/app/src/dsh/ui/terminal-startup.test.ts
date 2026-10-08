import { afterEach, expect, it, vi } from "vitest";

// Node cannot instantiate the native terminal view or its native sheet presenter.
vi.mock("@/components/terminal-emulator", () => ({ default: () => null }));
vi.mock("@/components/adaptive-modal-sheet", () => ({ AdaptiveModalSheet: () => null }));
vi.mock("@/terminal/runtime/terminal-emulator-runtime", () => {
  throw new Error("The native terminal must not load the DOM renderer");
});

afterEach(() => vi.unstubAllGlobals());

it("loads DSH terminal controls without WebAssembly or the DOM terminal runtime", async () => {
  vi.stubGlobal("WebAssembly", undefined);
  const { TerminalControl } = await import("./terminal");
  expect(TerminalControl).toBeTypeOf("function");
});
