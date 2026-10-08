import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompanionDiscoveryResult } from "@getpaseo/protocol/companion-discovery";
import { CompanionDiscoverySection } from "./companion-discovery-section";

const mocks = vi.hoisted(() => ({
  desktop: false,
  paired: false,
  local: vi.fn(),
  remote: vi.fn(),
  query:
    vi.fn<
      (options: { enabled: boolean; queryFn: () => Promise<CompanionDiscoveryResult> }) => void
    >(),
}));
vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => mocks.desktop }));
vi.mock("@/dsh/desktop/bridge", () => ({ desktopDshRequest: mocks.local }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  getHostRuntimeStore: () => ({
    subscribeAll: () => () => {},
    getHosts: () => (mocks.paired ? [{ serverId: "paired" }] : []),
    getSnapshot: () => ({
      connectionStatus: "online",
      client: {
        getLastServerInfoMessage: () => ({
          features: { companionDiscovery: true },
          permissions: ["tunnel.manage"],
        }),
      },
    }),
    getClient: () => ({ discoverCompanions: mocks.remote }),
  }),
}));
vi.mock("@/data/query", () => ({
  useFetchQuery: (options: Parameters<typeof mocks.query>[0]) => {
    mocks.query(options);
    return { refetch: vi.fn(), isFetching: false, isError: false };
  },
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({ helper: {} }) } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./companion-connect-form", () => ({ CompanionConnectForm: () => null }));
vi.mock("./ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let root: Root;
let dom: JSDOM;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop = false;
  mocks.paired = false;
  dom = new JSDOM("<div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});
function connected() {}
async function render() {
  await act(async () => root.render(<CompanionDiscoverySection onConnected={connected} />));
  return mocks.query.mock.calls.at(-1)![0];
}
it("starts Desktop discovery with no paired hosts and preserves unavailable Tailscale status", async () => {
  mocks.desktop = true;
  const result = { status: "tailscale-disconnected", hosts: [], truncated: false };
  mocks.local.mockResolvedValue(result);
  const query = await render();
  expect(query.enabled).toBe(true);
  expect(await query.queryFn()).toEqual(result);
  expect(mocks.local).toHaveBeenCalledWith({ type: "discover-companions" });
  expect(mocks.remote).not.toHaveBeenCalled();
});
it("keeps mobile discovery on the paired host", async () => {
  mocks.paired = true;
  mocks.remote.mockResolvedValue({ status: "ready", hosts: [], truncated: false });
  const query = await render();
  expect(query.enabled).toBe(true);
  expect(await query.queryFn()).toEqual({ status: "ready", hosts: [], truncated: false });
  expect(mocks.remote).toHaveBeenCalledOnce();
  expect(mocks.local).not.toHaveBeenCalled();
});
it("does not offer a local scan to an unpaired mobile client", async () => {
  expect((await render()).enabled).toBe(false);
});
