import { describe, expect, it } from "vitest";
import { createCompanionDiscovery, type CompanionDiscoveryPorts } from "./companion-discovery.js";

const advertisement = {
  service: "dsh-companion",
  version: 1,
  serverId: "mac",
  hostname: "My Mac",
  passwordRequired: false,
};
function ports(status: unknown, probe: CompanionDiscoveryPorts["probe"]): CompanionDiscoveryPorts {
  return { readStatus: async () => status, probe };
}

describe("companion discovery", () => {
  it("checks only unique online tailnet addresses and retains verified DSH companions", async () => {
    const checked: string[] = [];
    const discover = createCompanionDiscovery(
      ports(
        {
          BackendState: "Running",
          Self: { TailscaleIPs: ["100.64.0.1", "::1"] },
          Peer: {
            a: { Online: true, TailscaleIPs: ["100.64.0.2"] },
            b: { Online: true, TailscaleIPs: ["127.0.0.1", "10.0.0.1", "100.64.0.1"] },
            c: { Online: false, TailscaleIPs: ["100.64.0.3"] },
            d: { Online: true, TailscaleIPs: ["100.64.0.4"] },
          },
        },
        async (address) => {
          checked.push(address);
          if (address === "100.64.0.2") return { status: "server_info", serverId: "paseo" };
          if (address === "100.64.0.4") throw new Error("Connection refused");
          return advertisement;
        },
      ),
    );
    expect(await discover()).toEqual({
      status: "ready",
      truncated: false,
      hosts: [{ ...advertisement, address: "100.64.0.1" }],
    });
    expect(checked.sort()).toEqual(["100.64.0.1", "100.64.0.2", "100.64.0.4"]);
  });

  it("reports disabled Tailscale and malformed local status without probing", async () => {
    const probe = async () => {
      throw new Error("must not probe");
    };
    expect(await createCompanionDiscovery(ports({ BackendState: "Stopped" }, probe))()).toEqual({
      status: "tailscale-disconnected",
      hosts: [],
      truncated: false,
    });
    expect(await createCompanionDiscovery(ports({}, probe))()).toEqual({
      status: "scan-failed",
      hosts: [],
      truncated: false,
    });
    expect(
      await createCompanionDiscovery({
        readStatus: async () => {
          throw new Error("missing CLI");
        },
        probe,
      })(),
    ).toEqual({ status: "tailscale-unavailable", hosts: [], truncated: false });
  });

  it("coalesces concurrent searches and limits both concurrency and peer count", async () => {
    let statusReads = 0;
    let active = 0;
    let peak = 0;
    let probes = 0;
    const discover = createCompanionDiscovery({
      readStatus: async () => {
        statusReads++;
        return {
          BackendState: "Running",
          Peer: Object.fromEntries(
            Array.from({ length: 300 }, (_, i) => [
              i,
              { Online: true, TailscaleIPs: [`100.64.${Math.floor(i / 256)}.${i % 256}`] },
            ]),
          ),
        };
      },
      probe: async (_address, signal) => {
        active++;
        probes++;
        peak = Math.max(active, peak);
        expect(signal.aborted).toBe(false);
        await Promise.resolve();
        active--;
        return advertisement;
      },
    });
    const [first, second] = await Promise.all([discover(), discover()]);
    expect(first).toBe(second);
    expect(first.truncated).toBe(true);
    expect(first.hosts).toHaveLength(1);
    expect(statusReads).toBe(1);
    expect(probes).toBe(256);
    expect(peak).toBeLessThanOrEqual(8);
    await discover();
    expect(statusReads).toBe(1);
  });
});
