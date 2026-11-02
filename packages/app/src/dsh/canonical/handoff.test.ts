import { expect, it, vi } from "vitest";
import { canonicalInterfaceMarker, qualifyCanonicalBrowser } from "./handoff";
it("qualifies only the canonical product marker with existing browser credentials", async () => {
  const fetcher = vi
    .fn<(input: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValue(new Response(canonicalInterfaceMarker));
  const signal = new AbortController().signal;
  await qualifyCanonicalBrowser(fetcher, signal);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/daedal/workspace", {
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
});
it.each([
  new Response("legacy interface"),
  new Response(canonicalInterfaceMarker, { status: 401 }),
])("refuses legacy or unauthorized bootstrap", async (response) => {
  await expect(
    qualifyCanonicalBrowser(
      vi.fn<(input: string, init: RequestInit) => Promise<Response>>().mockResolvedValue(response),
      new AbortController().signal,
    ),
  ).rejects.toThrow("Canonical interface unavailable");
});
it("does not hand off a late response after route disposal", async () => {
  const reply = Promise.withResolvers<Response>();
  const controller = new AbortController();
  const pending = qualifyCanonicalBrowser(
    vi.fn<(input: string, init: RequestInit) => Promise<Response>>().mockReturnValue(reply.promise),
    controller.signal,
  );
  controller.abort();
  reply.resolve(new Response(canonicalInterfaceMarker));
  await expect(pending).rejects.toThrow();
});
