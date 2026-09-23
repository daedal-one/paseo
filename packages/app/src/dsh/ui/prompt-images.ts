import * as ImagePicker from "expo-image-picker";
import type { DshPromptImage } from "../prompt";
import { detectPromptImageMediaType } from "./prompt-image-bytes";

/**
 * Pick images and return them as prompt content. Only images the Host's prompt contract admits
 * are returned; the client keeps no copy and uploads nothing before send.
 *
 * @throws when the picker returned assets but none could be read as an admitted image, so the
 * caller can show a visible failure instead of silently attaching nothing.
 */
export async function pickPromptImages(): Promise<readonly DshPromptImage[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    base64: true,
  });
  if (result.canceled) return [];
  const images: DshPromptImage[] = [];
  let unusable = 0;
  for (const asset of result.assets) {
    const base64 = asset.base64;
    const mediaType =
      base64 === undefined || base64 === null ? undefined : detectPromptImageMediaType(base64);
    if (base64 === undefined || base64 === null || mediaType === undefined) {
      unusable += 1;
      continue;
    }
    images.push({
      mediaType,
      data: base64,
      ...(asset.fileName === undefined || asset.fileName === null ? {} : { name: asset.fileName }),
    });
  }
  if (images.length === 0 && unusable > 0)
    throw new Error("No selected image could be read as an admitted image attachment");
  return images;
}
