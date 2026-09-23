import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import { DSH_PROMPT_FILE_LIMITS, type DshPromptFileSource } from "../files";

function unsafeLeaf(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      character === "/" ||
      character === "\\" ||
      code < 32 ||
      code === 127 ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      return true;
  }
  return false;
}

function validMetadata(assets: readonly DocumentPicker.DocumentPickerAsset[]): boolean {
  if (assets.length > DSH_PROMPT_FILE_LIMITS.maxFiles) return false;
  let total = 0;
  for (const asset of assets) {
    if (
      typeof asset.name !== "string" ||
      asset.name.trim() === "" ||
      unsafeLeaf(asset.name) ||
      new TextEncoder().encode(asset.name).byteLength > DSH_PROMPT_FILE_LIMITS.maxNameBytes ||
      !Number.isSafeInteger(asset.size) ||
      asset.size === undefined ||
      asset.size < 0 ||
      asset.size > DSH_PROMPT_FILE_LIMITS.maxFileBytes
    )
      return false;
    total += asset.size;
  }
  return total <= DSH_PROMPT_FILE_LIMITS.maxTotalBytes;
}

function encodeBytes(bytes: Uint8Array): string {
  let encoded = "";
  // All nonfinal chunks are divisible by three, so padding occurs only at the end.
  for (let offset = 0; offset < bytes.length; offset += 32766)
    encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 32766)));
  return encoded;
}

/** Dispose only resources explicitly owned by a returned picker source. */
export function disposePromptFileSources(sources: readonly DshPromptFileSource[]): void {
  for (const source of sources) {
    try {
      source.dispose?.();
    } catch {
      /* Local cleanup never grants another send. */
    }
  }
}

function webSource(asset: DocumentPicker.DocumentPickerAsset): DshPromptFileSource {
  if (
    !(asset.file instanceof File) ||
    asset.file.name !== asset.name ||
    asset.file.size !== asset.size
  )
    throw new Error("Invalid browser file metadata");
  let file: File | undefined = asset.file;
  const bytes = asset.file.size;
  return {
    name: asset.name,
    bytes,
    async read(signal) {
      signal.throwIfAborted();
      if (file === undefined) throw new Error("File selection was discarded");
      const data = await file.arrayBuffer();
      signal.throwIfAborted();
      if (file === undefined) throw new Error("File selection was discarded");
      if (data.byteLength !== bytes) throw new Error("File size changed");
      return encodeBytes(new Uint8Array(data));
    },
    dispose() {
      file = undefined;
    },
  };
}

/** Expo 14 copies native selections into this exact app-owned namespace before returning. */
function ownedCacheUri(uri: string, cache: string): boolean {
  try {
    const root = new URL(cache);
    const file = new URL(uri);
    const prefix = `${root.pathname.replace(/\/+$/u, "")}/DocumentPicker/`;
    if (
      root.protocol !== "file:" ||
      file.protocol !== "file:" ||
      file.host !== root.host ||
      file.username !== "" ||
      file.password !== "" ||
      file.search !== "" ||
      file.hash !== "" ||
      !file.pathname.startsWith(prefix)
    )
      return false;
    const leaf = decodeURIComponent(file.pathname.slice(prefix.length));
    return leaf !== "" && leaf !== "." && leaf !== ".." && !unsafeLeaf(leaf);
  } catch {
    return false;
  }
}

type NativeFiles = typeof import("expo-file-system");

function nativeSource(
  asset: DocumentPicker.DocumentPickerAsset,
  fs: NativeFiles,
): DshPromptFileSource {
  const { uri, name, size: bytes } = asset;
  if (!ownedCacheUri(uri, fs.Paths.cache.uri))
    throw new Error("Picker did not return an owned cache copy");
  let disposed = false;
  let reading = 0;
  const cleanup = () => {
    if (!disposed || reading > 0) return;
    try {
      new fs.File(uri).delete();
    } catch {
      /* Best-effort deletion of only this owned copy. */
    }
  };
  return {
    name,
    bytes: bytes!,
    async read(signal) {
      signal.throwIfAborted();
      if (disposed) throw new Error("File selection was discarded");
      reading += 1;
      try {
        const file = new fs.File(uri);
        if (!file.exists || file.size !== bytes) throw new Error("File size changed");
        const data = await file.base64();
        signal.throwIfAborted();
        if (disposed) throw new Error("File selection was discarded");
        return data;
      } finally {
        reading -= 1;
        cleanup();
      }
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        cleanup();
      }
    },
  };
}

/** Metadata-only selection. Native copying precedes JS budgets; these are not disk/memory limits. */
export async function pickPromptFiles(): Promise<readonly DshPromptFileSource[]> {
  // Must run directly in the press gesture: no lazy import/await before this picker call.
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: true,
    base64: false,
    copyToCacheDirectory: Platform.OS !== "web",
  });
  if (result.canceled || result.assets.length === 0) return [];
  const sources: DshPromptFileSource[] = [];
  const fs = Platform.OS === "web" ? null : await import("expo-file-system");
  try {
    if (!validMetadata(result.assets)) throw new Error("Invalid file selection metadata or budget");
    for (const asset of result.assets)
      sources.push(fs === null ? webSource(asset) : nativeSource(asset, fs));
    return sources;
  } catch (error) {
    disposePromptFileSources(sources);
    // Reject the whole batch, including owned copies not yet wrapped as sources.
    if (fs !== null)
      for (const asset of result.assets.slice(sources.length)) {
        const uri = asset.uri;
        if (!ownedCacheUri(uri, fs.Paths.cache.uri)) continue;
        try {
          new fs.File(uri).delete();
        } catch {
          /* Never delete provider/original URIs. */
        }
      }
    throw error;
  } finally {
    if (fs === null)
      for (const asset of result.assets) {
        if (asset.uri.startsWith("blob:")) URL.revokeObjectURL(asset.uri);
      }
  }
}
