import { z } from "zod";
import { connectionHostIdSchema } from "@deepseek-ai/dsh-client";

export const DSH_CANONICAL_SCHEME = "dshremote";
export const DSH_CANONICAL_ORIGIN = `${DSH_CANONICAL_SCHEME}://host`;
const id = z.string().uuid();
/** Per-message transfer bound; native staging has no aggregate body limit. */
export const CANONICAL_BODY_CHUNK_BYTES = 256 * 1024;
/** Durable creation receipts contain request metadata, never file bodies or credentials. */
export const canonicalCreationTextSchema = z
  .string()
  .refine((value) => new TextEncoder().encode(value).byteLength <= 1024 * 1024)
  .nullable();
const bodyChunk = z.string().max(Math.ceil(CANONICAL_BODY_CHUNK_BYTES / 3) * 4);
const requestPath = z.string().max(8192);

/** This bridge accepts data-plane requests only; enrollment and credentials remain native. */
export const canonicalRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("creation-read"), id }).strict(),
  z
    .object({
      kind: z.literal("creation-cas"),
      id,
      before: canonicalCreationTextSchema,
      after: canonicalCreationTextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("fetch"),
      id,
      path: requestPath,
      method: z.enum(["GET", "HEAD", "POST"]),
      headers: z
        .record(z.string().max(128), z.string().max(8192))
        .refine((value) => Object.keys(value).length <= 16),
      bodyStageId: id.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("body-open"), id }).strict(),
  z
    .object({
      kind: z.literal("body-write"),
      id,
      sequence: z.number().int().nonnegative().safe(),
      data: bodyChunk,
    })
    .strict(),
  z.object({ kind: z.literal("body-seal"), id }).strict(),
  z.object({ kind: z.literal("body-discard"), id }).strict(),
  z.object({ kind: z.literal("abort"), id }).strict(),
  z.object({ kind: z.literal("socket-open"), id }).strict(),
  z
    .object({
      kind: z.literal("socket-send"),
      id,
      data: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("socket-close"), id }).strict(),
  z
    .object({
      kind: z.literal("download"),
      id,
      path: requestPath,
      filename: z.string().min(1).max(255),
    })
    .strict(),
]);
export type CanonicalRequest = z.infer<typeof canonicalRequestSchema>;
export const canonicalOpenSchema = z.object({ hostId: connectionHostIdSchema }).strict();
export interface CanonicalResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface CanonicalSocketEvent {
  id: string;
  type: "open" | "message" | "error" | "close";
  data?: string;
}

/** Validate one exact same-origin route before adding native credentials. */
export function canonicalPathAllowed(path: string, method: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#"))
    return false;
  if (
    Array.from(path).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return false;
  let url: URL;
  let decoded: string;
  try {
    url = new URL(path, "https://host.invalid");
    decoded = decodeURIComponent(path.split("?")[0]!);
    if (url.origin !== "https://host.invalid" || url.username || url.password) return false;
  } catch {
    return false;
  }
  if (
    decoded.split("/").some((part) => part === "." || part === "..") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.includes("%")
  )
    return false;
  if (url.pathname.startsWith("/api/")) return allowedApiURL(url, method);
  return allowedStaticURL(url, method);
}
function allowedApiURL(url: URL, method: string): boolean {
  if (url.pathname === "/api/session.export") {
    const entries = [...url.searchParams.entries()];
    return (
      (method === "GET" || method === "HEAD") &&
      entries.length >= 1 &&
      entries.length <= 2 &&
      entries.filter(([key, value]) => key === "sessionId" && value.length > 0).length === 1 &&
      entries.every(
        ([key, value]) =>
          key === "sessionId" ||
          (key === "includeDescendants" && (value === "true" || value === "false")),
      )
    );
  }
  if (url.pathname === "/api/session/uploadFileBinary") {
    const entries = [...url.searchParams.entries()];
    return (
      method === "POST" &&
      entries.length >= 1 &&
      entries.length <= 2 &&
      entries.filter(([key, value]) => key === "sessionId" && value.length > 0).length === 1 &&
      entries.every(([key]) => key === "sessionId" || key === "name")
    );
  }
  return (
    method === "POST" &&
    url.search === "" &&
    (/^\/api\/[A-Za-z0-9_$.-]+\/[A-Za-z0-9_$.-]+$/.test(url.pathname) ||
      ["/api/$capabilities", "/api/pdf-assets"].includes(url.pathname))
  );
}
function allowedStaticURL(url: URL, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return (
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname.startsWith("/plugins/") ||
    url.pathname.startsWith("/assets/") ||
    /^\/[A-Za-z0-9_.-]+\.(?:ico|png|svg|woff2?|webmanifest)$/.test(url.pathname)
  );
}
