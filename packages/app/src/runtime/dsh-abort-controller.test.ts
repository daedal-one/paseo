import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDshAbortController } from "./dsh-abort-controller";

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve("react-native/package.json"));
const NativeAbortController = nativeRequire("abort-controller").AbortController;
const PlatformAbortController = globalThis.AbortController;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DSH cancellation on the installed React Native runtime", () => {
  it.each([undefined, null, "cancel", { cause: "user" }])(
    "preserves the first reason %j and emits once",
    (reason) => {
      vi.stubGlobal("AbortController", NativeAbortController);
      const untouched = new NativeAbortController();
      const controller = createDshAbortController();
      const aborted = vi.fn();
      controller.signal.addEventListener("abort", aborted);
      expect(() => controller.signal.throwIfAborted()).not.toThrow();
      controller.abort(reason);
      const saved = controller.signal.reason;
      if (reason === undefined) expect(saved).toMatchObject({ name: "AbortError" });
      else expect(saved).toBe(reason);
      let thrown = false;
      try {
        controller.signal.throwIfAborted();
      } catch (error) {
        thrown = true;
        expect(error).toBe(saved);
      }
      expect(thrown).toBe(true);
      controller.abort(new Error("later"));
      expect(controller.signal.reason).toBe(saved);
      expect(aborted).toHaveBeenCalledOnce();
      expect("reason" in untouched.signal).toBe(false);
      expect("throwIfAborted" in untouched.signal).toBe(false);
      expect(globalThis.AbortController).toBe(NativeAbortController);
    },
  );

  it("keeps a modern platform controller's cancellation behavior", () => {
    const controller = createDshAbortController();
    expect(controller).toBeInstanceOf(PlatformAbortController);
    expect(Object.hasOwn(controller, "abort")).toBe(false);
    const reason = new Error("stop");
    controller.abort(reason);
    expect(controller.signal.reason).toBe(reason);
    expect(() => controller.signal.throwIfAborted()).toThrow(reason);
  });
});
