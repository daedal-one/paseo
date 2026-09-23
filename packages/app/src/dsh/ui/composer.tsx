import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { DshPrompt, DshPromptImage, DshPromptSnapshot } from "../prompt";
import type { DshPromptFileSource } from "../files";
import { styles } from "./styles";
import { disposePromptFileSources, pickPromptFiles } from "./prompt-files";

/** The picker seam stays injectable so the composer's attachment wiring is testable without a device. */
async function pickFromLibrary(): Promise<readonly DshPromptImage[]> {
  const { pickPromptImages } = await import("./prompt-images");
  return await pickPromptImages();
}

function fileNotice(state: DshPromptSnapshot) {
  const hasFiles = state.selectedFiles.length > 0 || state.files.length > 0;
  if (hasFiles && state.submission.kind === "unknown") return "filePromptUnknown";
  if (state.fileUpload.kind === "unknown") return "fileUploadUnknown";
  if (state.fileSubmission.kind === "preparing") return "filePreparing";
  if (state.fileSubmission.kind === "uploading") return "fileUploading";
  if (state.fileSubmission.kind === "blocked")
    return state.fileSubmission.code === "prompt-rejected" ? "filePromptRejected" : "fileBlocked";
  if (
    state.selectedFiles.some((file) => file.status === "retired") ||
    state.files.some((file) => file.status === "retired")
  )
    return "fileRetired";
  if (state.fileSubmission.kind === "error") {
    if (state.fileSubmission.code === "read-failed" || state.fileSubmission.code === "invalid-data")
      return "fileReadFailed";
    return "filePreparationStopped";
  }
  if (state.fileAvailability === "offline") return "fileOffline";
  if (state.fileAvailability === "unavailable") return "fileUnavailable";
  return null;
}

interface AttachmentSelectionControlsProps {
  state: DshPromptSnapshot;
  locked: boolean;
  picking: "images" | "files" | null;
  pickFailed: "images" | "files" | null;
  onPickFiles(): Promise<void>;
  onDiscardSelection(): void;
  onAbandonFiles(): void;
  onRemoveFile: readonly (() => void)[];
}

/** Presentation only; both picker lifetimes and all mutation callbacks remain Composer-owned. */
function AttachmentSelectionControls({
  state,
  locked,
  picking,
  pickFailed,
  onPickFiles,
  onDiscardSelection,
  onAbandonFiles,
  onRemoveFile,
}: AttachmentSelectionControlsProps) {
  const { t } = useTranslation();
  const notice = fileNotice(state);
  const canDiscardFiles =
    (state.selectedFiles.length > 0 ||
      state.files.length > 0 ||
      state.fileUpload.kind === "unknown" ||
      state.fileSubmission.kind === "blocked") &&
    state.submission.kind !== "sending" &&
    state.submission.kind !== "unknown";
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        loading={picking === "files"}
        disabled={
          state.fileAvailability !== "ready" ||
          locked ||
          state.submission.kind === "sending" ||
          picking !== null
        }
        onPress={onPickFiles}
        accessibilityLabel={t("nativeDsh.composer.attachFiles")}
        testID="dsh-prompt-attach-files"
      >
        {t("nativeDsh.composer.attachFiles")}
      </Button>
      {picking !== null && (
        <Button
          size="sm"
          variant="ghost"
          onPress={onDiscardSelection}
          testID="dsh-prompt-discard-selection"
        >
          {t(
            picking === "files"
              ? "nativeDsh.composer.discardFileSelection"
              : "nativeDsh.composer.discardSelection",
          )}
        </Button>
      )}
      {pickFailed !== null && (
        <Text
          style={styles.error}
          accessibilityRole="alert"
          testID={
            pickFailed === "files" ? "dsh-prompt-file-pick-failed" : "dsh-prompt-attach-failed"
          }
        >
          {t(
            pickFailed === "files"
              ? "nativeDsh.composer.filePickFailed"
              : "nativeDsh.composer.attachFailed",
          )}
        </Text>
      )}
      {state.selectedFiles.length > 0 && (
        <View style={styles.group} testID="dsh-prompt-files">
          <Text style={styles.muted}>
            {t("nativeDsh.composer.filesSelected", { count: state.selectedFiles.length })}
          </Text>
          {state.selectedFiles.map((file, index) => (
            <View key={file.id} style={styles.group} testID="dsh-prompt-file">
              <Text selectable style={styles.text}>
                {t("nativeDsh.composer.fileDetail", { name: file.name, bytes: file.bytes })}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                disabled={locked || picking !== null}
                onPress={onRemoveFile[index]}
                testID="dsh-prompt-file-remove"
              >
                {t("nativeDsh.composer.fileRemove")}
              </Button>
            </View>
          ))}
        </View>
      )}
      {notice !== null && (
        <Text style={styles.muted} accessibilityLiveRegion="polite" testID="dsh-prompt-file-status">
          {t(`nativeDsh.composer.${notice}`)}
        </Text>
      )}
      {canDiscardFiles && (
        <Button
          size="sm"
          variant="outline"
          onPress={onAbandonFiles}
          testID="dsh-prompt-files-discard"
        >
          {t("nativeDsh.composer.fileDiscard")}
        </Button>
      )}
    </>
  );
}

/* eslint-disable react/no-array-index-key -- ordered draft attachment slots have no stable per-image identity. */
interface ComposerProps {
  model: DshPrompt;
  pickImages?: () => Promise<readonly DshPromptImage[]>;
  pickFiles?: () => Promise<readonly DshPromptFileSource[]>;
}

export function Composer({
  model,
  pickImages = pickFromLibrary,
  pickFiles = pickPromptFiles,
}: ComposerProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const editor = useRef<EditingTextInputHandle>(null);
  const [picking, setPicking] = useState<"images" | "files" | null>(null);
  const [pickFailed, setPickFailed] = useState<"images" | "files" | null>(null);
  const activePick = useRef<symbol | null>(null);
  // Invalidate callbacks before a different model/view can receive a late picker completion.
  useLayoutEffect(() => {
    activePick.current = null;
    setPicking(null);
    setPickFailed(null);
    return () => {
      activePick.current = null;
    };
  }, [model, state.fileSelectionEpoch]);
  const discardSelection = useCallback(() => {
    activePick.current = null;
    setPicking(null);
    setPickFailed(null);
  }, []);
  const send = useCallback(async () => {
    if (activePick.current !== null) return;
    await model.send();
  }, [model]);
  const attach = useCallback(async () => {
    const before = model.getSnapshot();
    if (
      activePick.current !== null ||
      before.draftLocked ||
      before.submission.kind === "unknown" ||
      before.availability !== "ready"
    )
      return;
    const selection = Symbol("image-selection");
    activePick.current = selection;
    setPickFailed(null);
    setPicking("images");
    try {
      const picked = await pickImages();
      if (
        activePick.current === selection &&
        before.fileSelectionEpoch === model.getSnapshot().fileSelectionEpoch &&
        picked.length > 0
      )
        model.setImages([...model.getSnapshot().images, ...picked]);
    } catch {
      if (
        activePick.current === selection &&
        before.fileSelectionEpoch === model.getSnapshot().fileSelectionEpoch
      )
        setPickFailed("images");
    } finally {
      if (activePick.current === selection) {
        activePick.current = null;
        setPicking(null);
      }
    }
  }, [model, pickImages]);
  const attachFiles = useCallback(async () => {
    const before = model.getSnapshot();
    if (
      activePick.current !== null ||
      before.draftLocked ||
      before.submission.kind === "unknown" ||
      before.submission.kind === "sending" ||
      before.fileAvailability !== "ready"
    )
      return;
    const selection = Symbol("file-selection");
    activePick.current = selection;
    setPickFailed(null);
    setPicking("files");
    let picked: readonly DshPromptFileSource[] = [];
    let transferred = false;
    try {
      picked = await pickFiles();
      if (
        activePick.current === selection &&
        before.fileSelectionEpoch === model.getSnapshot().fileSelectionEpoch &&
        picked.length > 0
      ) {
        transferred = model.selectFiles(picked, before.fileSelectionEpoch);
        if (!transferred) setPickFailed("files");
      }
    } catch {
      if (
        activePick.current === selection &&
        before.fileSelectionEpoch === model.getSnapshot().fileSelectionEpoch
      )
        setPickFailed("files");
    } finally {
      if (!transferred) disposePromptFileSources(picked);
      if (activePick.current === selection) {
        activePick.current = null;
        setPicking(null);
      }
    }
  }, [model, pickFiles]);
  const abandonFiles = useCallback(() => {
    model.abandonFiles();
  }, [model]);
  const remove = useCallback(
    (index: number) => {
      model.setImages(model.getSnapshot().images.filter((_, current) => current !== index));
    },
    [model],
  );
  /** One stable remover per attachment slot, so a row never receives a freshly created callback. */
  const removeAt = useMemo(
    () => state.images.map((_, index) => () => remove(index)),
    [state.images, remove],
  );
  const removeFileAt = useMemo(
    () =>
      state.selectedFiles.map((file) => () => {
        model.removeFile(file.id);
      }),
    [model, state.selectedFiles],
  );
  useEffect(() => {
    if (state.submission.kind === "accepted" && model.getSnapshot() === state) {
      editor.current?.replaceText(state.text);
    }
  }, [model, state]);
  if (state.availability === "subagent") return null;
  const retained = state.submission.kind === "unknown" ? state.submission.images : [];
  const locked = state.draftLocked || state.submission.kind === "unknown";
  return (
    <View style={[styles.content, styles.composer]} testID="dsh-composer">
      <ScrollView
        style={styles.composerFields}
        contentContainerStyle={styles.group}
        keyboardShouldPersistTaps="handled"
      >
        <Field label={t("nativeDsh.composer.label")}>
          <FormTextInput
            ref={editor}
            initialValue={state.text}
            onChangeText={model.setText}
            editable={!locked}
            multiline
            numberOfLines={6}
            size="md"
            accessibilityLabel={t("nativeDsh.composer.label")}
            placeholder={t("nativeDsh.composer.placeholder")}
            testID="dsh-prompt-text"
          />
        </Field>

        <Button
          size="sm"
          variant="outline"
          loading={picking === "images"}
          disabled={state.availability !== "ready" || locked || picking !== null}
          onPress={attach}
          accessibilityLabel={t("nativeDsh.composer.attach")}
          testID="dsh-prompt-attach"
        >
          {t("nativeDsh.composer.attach")}
        </Button>
        <AttachmentSelectionControls
          state={state}
          locked={locked}
          picking={picking}
          pickFailed={pickFailed}
          onPickFiles={attachFiles}
          onDiscardSelection={discardSelection}
          onAbandonFiles={abandonFiles}
          onRemoveFile={removeFileAt}
        />

        {state.images.length > 0 && (
          <View style={styles.group} testID="dsh-prompt-attachments">
            <Text style={styles.muted}>
              {t("nativeDsh.composer.attachments", { count: state.images.length })}
            </Text>
            {/* Attachment slots are ordered; the draft list has no stable per-image identity. */}
            {state.images.map((image, index) => (
              <View key={index} style={styles.group} testID="dsh-prompt-attachment">
                <Text selectable style={styles.text}>
                  {t("nativeDsh.composer.attachmentDetail", {
                    name: image.name ?? t("nativeDsh.composer.attachmentUnnamed"),
                    media: image.mediaType,
                  })}
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onPress={removeAt[index]}
                  accessibilityLabel={t("nativeDsh.composer.attachmentRemove")}
                  testID="dsh-prompt-attachment-remove"
                >
                  {t("nativeDsh.composer.attachmentRemove")}
                </Button>
              </View>
            ))}
          </View>
        )}
        {retained.length > 0 && (
          <Text style={styles.muted} testID="dsh-prompt-unconfirmed-images">
            {t("nativeDsh.composer.unconfirmedImages", { count: retained.length })}
          </Text>
        )}

        {state.submission.kind === "accepted" && (
          <Text style={styles.muted} accessibilityLiveRegion="polite">
            {t("nativeDsh.composer.accepted")}
          </Text>
        )}
        {state.submission.kind === "rejected" && (
          <Text style={styles.error} accessibilityRole="alert">
            {t("nativeDsh.composer.rejected")}
          </Text>
        )}
        {state.submission.kind === "unknown" && (
          <View style={styles.group}>
            <Text style={styles.error} accessibilityRole="alert">
              {t("nativeDsh.composer.unknown")}
            </Text>
            {state.submission.text !== state.text && (
              <>
                <Text style={styles.muted}>{t("nativeDsh.composer.unconfirmed")}</Text>
                <Text selectable style={styles.message}>
                  {state.submission.text}
                </Text>
              </>
            )}
          </View>
        )}
      </ScrollView>
      <Button disabled={!state.canSend || picking !== null} onPress={send} testID="dsh-prompt-send">
        {state.submission.kind === "sending"
          ? t("nativeDsh.composer.sending")
          : t("nativeDsh.composer.send")}
      </Button>
    </View>
  );
}
