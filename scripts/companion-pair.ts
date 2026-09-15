import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as QRCode from "qrcode";
import { parseArgs } from "node:util";
import {
  CompanionAdvertisementSchema,
  encodeCompanionPairingUrl,
  isTailscaleAddress,
} from "../packages/protocol/src/companion-discovery.js";
import {
  probeCompanion,
  readTailscaleStatus,
} from "../packages/server/src/server/companion-discovery.js";
import { z } from "zod";

const { values } = parseArgs({
  options: { output: { type: "string", default: ".dev/companion-pair.png" } },
});
async function main() {
  const status = z
    .object({
      BackendState: z.literal("Running"),
      Self: z.object({ TailscaleIPs: z.array(z.string()) }),
    })
    .parse(await readTailscaleStatus());
  const address = status.Self.TailscaleIPs.find(isTailscaleAddress);
  if (!address) throw new Error("This host has no Tailscale IPv4 address.");
  const advertisement = CompanionAdvertisementSchema.parse(
    await probeCompanion(address, AbortSignal.timeout(5_000)),
  );
  const url = encodeCompanionPairingUrl({ ...advertisement, address });
  const output = path.resolve(values.output);
  await mkdir(path.dirname(output), { recursive: true });
  await QRCode.toFile(output, url, { width: 640, margin: 4 });
  const outputPath = path.parse(output);
  await writeFile(path.join(outputPath.dir, `${outputPath.name}.txt`), `${url}\n`, { mode: 0o600 });
  console.log(
    `In DSH Companion, choose Scan QR code. Connect Tailscale on the phone first.\nQR: ${output}`,
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to create pairing QR.");
  console.error(
    "Check that this host's companion is running and reachable through Tailscale TCP port 6769.",
  );
  process.exitCode = 1;
});
