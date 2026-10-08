import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ImagePicker from "expo-image-picker";
import { detectPromptImageMediaType } from "./prompt-image-bytes";
import { pickPromptImages } from "./prompt-images";

// Mock only the OS picker boundary; exercise the real selection and byte conversion code.
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

/** Real signature bytes, base64-encoded, for each media type the Host admits. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const WEBP = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

const pickedPng = {
  uri: "file:///picked.png",
  width: 1,
  height: 1,
  base64: PNG,
  fileName: "picked.png",
};

describe("native prompt image selection", () => {
  it("keeps every image in order and derives type from bytes rather than MIME or name", async () => {
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        { ...pickedPng, fileName: "misnamed.jpeg", mimeType: "image/jpeg" },
        { ...pickedPng, base64: GIF, fileName: "second.gif" },
      ],
    });
    expect(await pickPromptImages()).toEqual([
      { data: PNG, mediaType: "image/png", name: "misnamed.jpeg" },
      { data: GIF, mediaType: "image/gif", name: "second.gif" },
    ]);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      base64: true,
    });
  });

  it.each([null, undefined, "JVBERi0xLjQKJcOkw7zDtsOfCg=="])(
    "rejects the whole mixed selection when one payload is %s",
    async (base64) => {
      vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
        canceled: false,
        assets: [pickedPng, { ...pickedPng, base64, fileName: "unreadable.png" }],
      });
      await expect(pickPromptImages()).rejects.toThrow();
    },
  );

  it("treats explicit picker cancellation as no draft addition", async () => {
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: true,
      assets: null,
    });
    expect(await pickPromptImages()).toEqual([]);
  });
});

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
