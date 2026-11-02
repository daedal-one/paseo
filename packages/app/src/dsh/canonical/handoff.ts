export const canonicalInterfaceMarker = '<meta name="dsh-canonical-interface" content="1">';
/** Bootstrap qualification proves the intended page, never authentication or Host identity. */
export async function qualifyCanonicalBrowser(
  fetcher: (input: string, init: RequestInit) => Promise<Response>,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetcher("/daedal/workspace", {
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok || !(await response.text()).includes(canonicalInterfaceMarker))
    throw new Error("Canonical interface unavailable");
  signal.throwIfAborted();
}
