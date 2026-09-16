import { z } from "zod";
import { connectionDeviceEnrollmentSchema } from "@deepseek-ai/dsh-client";
import { DshAccessError } from "./access-error";
import { parseDshOrigin } from "./host-origin";

const pairingSchema = z
  .object({
    version: z.literal(1),
    origin: z.string(),
    enrollment: connectionDeviceEnrollmentSchema,
  })
  .strict();
export type DshPairing = z.infer<typeof pairingSchema>;

/** Validate untrusted QR data before displaying its endpoint or making any request. */
export function parseDshPairing(value: unknown): DshPairing {
  const result = pairingSchema.safeParse(value);
  if (!result.success) throw new DshAccessError("invalid-enrollment");
  const origin = parseDshOrigin(result.data.origin);
  if (result.data.enrollment.expiresAt <= Date.now())
    throw new DshAccessError("expired-enrollment");
  return { ...result.data, origin };
}

/** QR contents remain in memory; they never enter route parameters or diagnostics. */
export function decodeDshPairing(raw: string): DshPairing {
  if (raw.length > 4096) throw new DshAccessError("invalid-enrollment");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DshAccessError("invalid-enrollment");
  }
  return parseDshPairing(value);
}
