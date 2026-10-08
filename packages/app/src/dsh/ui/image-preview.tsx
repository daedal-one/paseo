import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type {
  DshImagePreview,
  DshImageReady,
  DshImages,
  DshImagesSnapshot,
  ImageAttachmentRef,
} from "../images";
import { styles } from "./styles";

interface ImagePreviewProps {
  attachment: ImageAttachmentRef;
  images: DshImages;
}
interface ReadyImageProps {
  ready: DshImageReady;
  images: DshImages;
  label: string;
}

const boundedImage = { width: "100%", height: 200 } as const;

function selectedPreview(preview: DshImagePreview, owner: object, attachment: ImageAttachmentRef) {
  if (preview.status === "idle") return null;
  const selected =
    preview.owner === owner &&
    preview.id === attachment.attachmentId &&
    preview.ref.mediaType === attachment.mediaType &&
    preview.ref.bytes === attachment.bytes &&
    preview.ref.width === attachment.width &&
    preview.ref.height === attachment.height &&
    preview.ref.name === attachment.name;
  return selected ? preview : null;
}

function explanationKey(state: DshImagesSnapshot, status: DshImagePreview["status"]) {
  if (state.availability === "offline") return "nativeDsh.images.offline";
  if (state.availability === "unavailable") return "nativeDsh.images.unavailable";
  if (status === "too-large") return "nativeDsh.images.tooLarge";
  if (status === "failed") return "nativeDsh.images.failed";
  if (state.busy && status !== "loading") return "nativeDsh.images.busy";
  if (status === "busy") return "nativeDsh.images.busy";
  return null;
}

function ReadyImage({ ready, images, label }: ReadyImageProps) {
  const source = useMemo(() => ({ uri: ready.uri }), [ready.uri]);
  const decodeFailed = useCallback(() => images.decodeFailed(ready), [images, ready]);
  return (
    <Image
      testID="dsh-image-preview"
      source={source}
      style={boundedImage}
      resizeMode="contain"
      accessibilityLabel={label}
      onError={decodeFailed}
    />
  );
}

/** Metadata stays with the caller; this surface owns only explicit read controls and pixels. */
export function ImagePreview({ attachment, images }: ImagePreviewProps) {
  const { t } = useTranslation();
  const owner = useRef({}).current;
  const { attachmentId, mediaType, bytes, width, height, name } = attachment;
  const state = useSyncExternalStore(images.subscribe, images.getSnapshot, images.getSnapshot);
  const selected = selectedPreview(state.preview, owner, attachment);
  const status = selected?.status ?? "idle";
  const loading = status === "loading";
  const ready = selected?.status === "ready" ? selected : null;
  const retry = status === "failed" || status === "busy";
  const canHide = loading || ready !== null;
  // Equal cloned refs preserve this occurrence; changes/unmount release only its own selection.
  useLayoutEffect(
    () => () => images.hide(owner),
    [images, owner, attachmentId, mediaType, bytes, width, height, name],
  );
  const load = useCallback(() => void images.load(attachment, owner), [images, attachment, owner]);
  const hide = useCallback(() => images.hide(owner), [images, owner]);
  const explanation = explanationKey(state, status);
  const tooLarge = status === "too-large";
  const disabled = state.availability !== "available" || state.busy || loading || tooLarge;

  return (
    <View style={styles.group}>
      {explanation !== null && (
        <Text style={styles.muted} testID="dsh-image-error">
          {t(explanation)}
        </Text>
      )}
      <View style={styles.actions}>
        {ready === null && (
          <Button
            testID="dsh-image-load"
            variant="ghost"
            size="sm"
            loading={loading}
            disabled={disabled}
            onPress={load}
          >
            {retry ? t("nativeDsh.images.retry") : t("nativeDsh.images.load")}
          </Button>
        )}
        {canHide && (
          <Button testID="dsh-image-hide" variant="ghost" size="sm" onPress={hide}>
            {t("nativeDsh.images.hide")}
          </Button>
        )}
      </View>
      {ready !== null && (
        <ReadyImage
          key={ready.sequence}
          ready={ready}
          images={images}
          label={name ?? t("nativeDsh.conversation.imageUnnamed")}
        />
      )}
    </View>
  );
}
