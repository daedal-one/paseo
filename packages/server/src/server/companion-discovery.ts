import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import {
  COMPANION_DISCOVERY_PATH,
  COMPANION_PORT,
  CompanionAdvertisementSchema,
  isTailscaleAddress,
  type CompanionDiscoveryResult,
  type CompanionHost,
} from "@getpaseo/protocol/companion-discovery";

const execFileAsync = promisify(execFile);
const PeerSchema = z.object({
  Online: z.boolean().optional(),
  TailscaleIPs: z.array(z.string()).optional(),
});
const StatusSchema = z.object({
  BackendState: z.string(),
  Self: PeerSchema.optional(),
  Peer: z.record(z.string(), PeerSchema).optional(),
});

export interface CompanionDiscoveryPorts {
  readStatus(): Promise<unknown>;
  probe(address: string, signal: AbortSignal): Promise<unknown>;
}

export async function readTailscaleStatus(): Promise<unknown> {
  const macCli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  const command = process.platform === "darwin" && existsSync(macCli) ? macCli : "tailscale";
  const { stdout } = await execFileAsync(command, ["status", "--json"], {
    env: { ...process.env, TAILSCALE_BE_CLI: "1" },
    timeout: 3_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** Probe only a canonical peer IP; never follow redirects or forward host credentials. */
export async function probeCompanion(address: string, signal: AbortSignal): Promise<unknown> {
  if (!isTailscaleAddress(address)) throw new Error("Invalid Tailscale address");
  const response = await fetch(`http://${address}:${COMPANION_PORT}${COMPANION_DISCOVERY_PATH}`, {
    redirect: "error",
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  // Advertisements are tiny. Bound the body independently of an untrusted Content-Length.
  const reader = response.body?.getReader();
  if (!reader) return null;
  try {
    let text = "";
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) throw new Error("Companion advertisement is too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** A shared, bounded search of peers visible to this host's Tailscale identity. */
export function createCompanionDiscovery(
  ports: CompanionDiscoveryPorts = {
    readStatus: readTailscaleStatus,
    probe: probeCompanion,
  },
): () => Promise<CompanionDiscoveryResult> {
  let pending: Promise<CompanionDiscoveryResult> | null = null;
  let cached: { until: number; result: CompanionDiscoveryResult } | null = null;
  async function scan(): Promise<CompanionDiscoveryResult> {
    let raw: unknown;
    try {
      raw = await ports.readStatus();
    } catch {
      return { status: "tailscale-unavailable", hosts: [], truncated: false };
    }
    const status = StatusSchema.safeParse(raw);
    if (!status.success) return { status: "scan-failed", hosts: [], truncated: false };
    if (status.data.BackendState !== "Running")
      return { status: "tailscale-disconnected", hosts: [], truncated: false };
    const addresses = [
      ...new Set(
        [
          ...(status.data.Self?.TailscaleIPs ?? []),
          ...Object.values(status.data.Peer ?? {})
            .filter((peer) => peer.Online === true)
            .flatMap((peer) => peer.TailscaleIPs ?? []),
        ].filter(isTailscaleAddress),
      ),
    ];
    const candidates = addresses.slice(0, 256);
    const deadline = AbortSignal.timeout(8_000);
    const hosts = new Map<string, CompanionHost>();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, candidates.length) }, async () => {
        while (!deadline.aborted && next < candidates.length) {
          const address = candidates[next++];
          try {
            const advertisement = CompanionAdvertisementSchema.safeParse(
              await ports.probe(address, AbortSignal.any([deadline, AbortSignal.timeout(3_000)])),
            );
            if (advertisement.success && !hosts.has(advertisement.data.serverId)) {
              hosts.set(advertisement.data.serverId, { ...advertisement.data, address });
            }
          } catch {
            // Offline peers, access rules, and non-companion services are not discovery results.
          }
        }
      }),
    );
    return {
      status: "ready",
      hosts: [...hosts.values()].sort((a, b) => a.hostname.localeCompare(b.hostname)),
      truncated: addresses.length > candidates.length || deadline.aborted,
    };
  }
  return () => {
    if (pending) return pending;
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.result);
    pending = scan()
      .then((result) => {
        cached = { until: Date.now() + 15_000, result };
        return result;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
