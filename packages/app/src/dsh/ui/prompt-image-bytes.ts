import type { DshPromptImageMediaType } from "../prompt";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode the first whole bytes of a base64 payload without depending on a platform global. */
function decodePrefix(base64: string, length: number): Uint8Array {
  const clean = base64.slice(0, Math.ceil((length * 4) / 3)).replace(/=+$/, "");
  const bytes = new Uint8Array(length);
  let byte = 0;
  let accumulator = 0;
  let bits = 0;
  for (const character of clean) {
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) break;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byte] = (accumulator >> bits) & 0xff;
      byte += 1;
      if (byte === length) break;
    }
  }
  return bytes.subarray(0, byte);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * Identify the admitted media type from the encoded bytes themselves. The picker's reported MIME
 * type is not authoritative: some platforms re-encode the payload, and the Host validates the
 * declared type against the bytes. An unrecognized payload returns undefined and is never sent.
 */
export function detectPromptImageMediaType(base64: string): DshPromptImageMediaType | undefined {
  const bytes = decodePrefix(base64, 12);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return undefined;
}
