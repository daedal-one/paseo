import { DshAccessError } from "./access-error";

/** Cleartext is confined to the local machine or numeric Tailscale addresses. */
export function parseDshOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DshAccessError("invalid-origin");
  }
  const hasExtras =
    url.username !== "" || url.password !== "" || value.includes("?") || value.includes("#");
  if (hasExtras || url.pathname !== "/" || value !== value.trim()) {
    throw new DshAccessError("invalid-origin");
  }
  const secure = url.protocol === "https:";
  const privateHttp = url.protocol === "http:" && isPrivateHost(url.hostname);
  if (!secure && !privateHttp) throw new DshAccessError("invalid-origin");
  return url.origin;
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  if (host.startsWith("[fd7a:115c:a1e0:")) return true;
  const parts = host.split(".").map(Number);
  const isV4 =
    parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  return isV4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}
