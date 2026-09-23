import { describe, expect, it } from "vitest";
import { detectPromptImageMediaType } from "./prompt-image-bytes";

/** Real signature bytes, base64-encoded, for each media type the Host admits. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const WEBP = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

describe("prompt image byte detection", () => {
  it("identifies each admitted media type from its own bytes", () => {
    expect(detectPromptImageMediaType(PNG)).toBe("image/png");
    expect(detectPromptImageMediaType(JPEG)).toBe("image/jpeg");
    expect(detectPromptImageMediaType(GIF)).toBe("image/gif");
    expect(detectPromptImageMediaType(WEBP)).toBe("image/webp");
  });

  it("ignores the reported name and refuses unrecognized bytes", () => {
    expect(detectPromptImageMediaType("")).toBeUndefined();
    expect(detectPromptImageMediaType("not-base64!!")).toBeUndefined();
    // A PDF header named like an image is still not an admitted image payload.
    expect(detectPromptImageMediaType("JVBERi0xLjQKJcOkw7zDtsOfCg==")).toBeUndefined();
    // RIFF container that is not WEBP (here: WAVE).
    expect(detectPromptImageMediaType("UklGRgAAAABXQVZF")).toBeUndefined();
  });

  it("detects a truncated payload that still carries the full signature", () => {
    expect(detectPromptImageMediaType("iVBORw0KGgo")).toBe("image/png");
    expect(detectPromptImageMediaType("R0lGODlh")).toBe("image/gif");
  });
});
