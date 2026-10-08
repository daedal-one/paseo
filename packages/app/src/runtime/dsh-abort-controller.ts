/** Create a DSH-owned controller without changing platform globals or prototypes. */
export function createDshAbortController(): AbortController {
  const controller = new AbortController();
  const signal = controller.signal;
  if (!Reflect.has(signal, "reason")) {
    let reason: unknown;
    const abort = controller.abort.bind(controller);
    Object.defineProperty(signal, "reason", { get: () => reason });
    controller.abort = (value?: unknown) => {
      if (signal.aborted) return;
      if (value === undefined) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reason = error;
      } else {
        reason = value;
      }
      abort(value);
    };
  }
  if (typeof signal.throwIfAborted !== "function") {
    Object.defineProperty(signal, "throwIfAborted", {
      value: () => {
        if (signal.aborted) throw signal.reason;
      },
    });
  }
  return controller;
}
