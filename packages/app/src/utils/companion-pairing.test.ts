import { describe, expect, it } from "vitest";
import { AbortController } from "abort-controller";
import { pairCompanion } from "./companion-pairing";
const host = {
  service: "dsh-companion" as const,
  version: 1 as const,
  address: "100.64.0.1",
  serverId: "mac",
  hostname: "Mac",
  passwordRequired: true,
};

describe("companion pairing", () => {
  it("saves a verified host after closing the probe, with its own password", async () => {
    const calls: unknown[] = [];
    const result = await pairCompanion(host, "host-password", new AbortController().signal, {
      probe: async (endpoint, password) => {
        calls.push({ endpoint, password });
        return {
          serverId: "mac",
          close: async () => {
            calls.push("closed");
          },
        };
      },
      save: async (input) => {
        calls.push(input);
        return "saved";
      },
    });
    expect(result).toBe("saved");
    expect(calls).toEqual([
      { endpoint: "100.64.0.1:6769", password: "host-password" },
      "closed",
      {
        serverId: "mac",
        endpoint: "100.64.0.1:6769",
        password: "host-password",
        label: "Mac",
        useTls: false,
      },
    ]);
  });
  it.each(["wrong-host", "dismissed"])(
    "does not save %s results and releases the probe",
    async (scenario) => {
      const controller = new AbortController();
      let closed = false;
      let saved = false;
      await expect(
        pairCompanion(host, "", controller.signal, {
          probe: async () => {
            if (scenario === "dismissed") controller.abort();
            return {
              serverId: "unexpected",
              close: async () => {
                closed = true;
              },
            };
          },
          save: async () => {
            saved = true;
          },
        }),
      ).rejects.toThrow();
      expect(closed).toBe(true);
      expect(saved).toBe(false);
    },
  );
});
