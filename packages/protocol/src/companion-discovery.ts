import { z } from "zod";

/** Private Tailscale TCP service used by hosts prepared with companion:setup. */
export const COMPANION_PORT = 6769;
export const COMPANION_DISCOVERY_PATH = "/.well-known/dsh-companion";
const PAIRING_PREFIX = "dsh-companion://pair#companion=";

export const CompanionAdvertisementSchema = z.object({
  service: z.literal("dsh-companion"),
  version: z.literal(1),
  serverId: z.string().min(1).max(128),
  hostname: z.string().min(1).max(255),
  passwordRequired: z.boolean(),
});
export const CompanionHostSchema = CompanionAdvertisementSchema.extend({
  address: z.string().max(15),
});
export type CompanionHost = z.infer<typeof CompanionHostSchema>;

export const CompanionDiscoveryResultSchema = z.object({
  status: z.enum(["ready", "tailscale-unavailable", "tailscale-disconnected", "scan-failed"]),
  hosts: z.array(CompanionHostSchema).max(256),
  truncated: z.boolean(),
});
export type CompanionDiscoveryResult = z.infer<typeof CompanionDiscoveryResultSchema>;

/** Accept only canonical IPv4 addresses from Tailscale's own allocation. */
export function isTailscaleAddress(address: string): boolean {
  const parts = address.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255) &&
    parts[0] === "100" &&
    Number(parts[1]) >= 64 &&
    Number(parts[1]) <= 127
  );
}

/** This QR carries a private address and expected host identity, never a credential. */
export function encodeCompanionPairingUrl(host: CompanionHost): string {
  CompanionHostSchema.parse(host);
  if (!isTailscaleAddress(host.address)) throw new Error("Invalid Tailscale address");
  return `${PAIRING_PREFIX}${encodeURIComponent(JSON.stringify(host))}`;
}

export function decodeCompanionPairingUrl(value: string): CompanionHost {
  // React Native's URL implementation does not expose hosts for custom schemes.
  const raw = value.trim();
  if (raw.length > 8192 || !raw.startsWith(PAIRING_PREFIX)) {
    throw new Error("Invalid companion pairing link");
  }
  const host = CompanionHostSchema.parse(
    JSON.parse(decodeURIComponent(raw.slice(PAIRING_PREFIX.length))),
  );
  if (!isTailscaleAddress(host.address)) throw new Error("Invalid Tailscale address");
  return host;
}
