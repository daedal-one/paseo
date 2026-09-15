import {
  COMPANION_PORT,
  CompanionHostSchema,
  isTailscaleAddress,
  type CompanionHost,
} from "@getpaseo/protocol/companion-discovery";

export class CompanionPairingError extends Error {
  constructor(readonly code: "invalidHost" | "hostChanged") {
    super(code);
    this.name = "CompanionPairingError";
  }
}

export interface CompanionPairingPorts<Profile> {
  probe(endpoint: string, password: string): Promise<{ serverId: string; close(): Promise<void> }>;
  save(input: {
    serverId: string;
    endpoint: string;
    password: string;
    label: string;
    useTls: false;
  }): Promise<Profile>;
}

/** Verify the phone can reach the advertised identity before remembering the connection. */
export async function pairCompanion<Profile>(
  host: CompanionHost,
  password: string,
  signal: Pick<AbortSignal, "aborted">,
  ports: CompanionPairingPorts<Profile>,
): Promise<Profile> {
  if (!CompanionHostSchema.safeParse(host).success || !isTailscaleAddress(host.address))
    throw new CompanionPairingError("invalidHost");
  const endpoint = `${host.address}:${COMPANION_PORT}`;
  if (signal.aborted) throw new Error("Pairing cancelled");
  const probe = await ports.probe(endpoint, password);
  try {
    if (signal.aborted) throw new Error("Pairing cancelled");
    if (probe.serverId !== host.serverId) throw new CompanionPairingError("hostChanged");
  } finally {
    await probe.close();
  }
  if (signal.aborted) throw new Error("Pairing cancelled");
  return ports.save({
    serverId: host.serverId,
    endpoint,
    password,
    label: host.hostname,
    useTls: false,
  });
}
