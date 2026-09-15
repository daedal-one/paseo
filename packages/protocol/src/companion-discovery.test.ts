import { describe, expect, it } from "vitest";
import {
  decodeCompanionPairingUrl,
  encodeCompanionPairingUrl,
  isTailscaleAddress,
} from "./companion-discovery.js";

describe("companion pairing", () => {
  it("round trips names and identity without credentials", () => {
    const host = {
      service: "dsh-companion" as const,
      version: 1 as const,
      address: "100.110.130.124",
      serverId: "host-1",
      hostname: "Carlo's Mac — DSH",
      passwordRequired: false,
    };
    expect(decodeCompanionPairingUrl(encodeCompanionPairingUrl(host))).toEqual(host);
  });
  it.each([
    "127.0.0.1",
    "100.128.0.1",
    "100.63.0.1",
    "100.64.0.256",
    "100.064.0.1",
    "100.64.0.1.example.org",
    "100.64.0.1/path",
    "::1",
  ])("rejects noncanonical or non-tailnet address %s", (address) => {
    expect(isTailscaleAddress(address)).toBe(false);
    const payload = {
      service: "dsh-companion",
      version: 1,
      address,
      serverId: "host",
      hostname: "Host",
      passwordRequired: false,
    };
    expect(() =>
      decodeCompanionPairingUrl(
        `dsh-companion://pair#companion=${encodeURIComponent(JSON.stringify(payload))}`,
      ),
    ).toThrow();
  });
  it("rejects malformed and unrelated QR codes", () => {
    expect(() => decodeCompanionPairingUrl("https://example.com/#companion={}")).toThrow();
    expect(() => decodeCompanionPairingUrl("dsh-companion://pair#companion=%7B")).toThrow();
  });
});
