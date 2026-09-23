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
import type { DshPrompt, DshPromptImage } from "../prompt";
import { styles } from "./styles";

/** The picker seam stays injectable so the composer's attachment wiring is testable without a device. */
async function pickFromLibrary(): Promise<readonly DshPromptImage[]> {
  const { pickPromptImages } = await import("./prompt-images");
  return await pickPromptImages();
}

/* eslint-disable react/no-array-index-key -- ordered draft attachment slots have no stable per-image identity. */
interface ComposerProps {
  model: DshPrompt;
  pickImages?: () => Promise<readonly DshPromptImage[]>;
}

export function Composer({ model, pickImages = pickFromLibrary }: ComposerProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const editor = useRef<EditingTextInputHandle>(null);
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const activePick = useRef<symbol | null>(null);
  // Invalidate callbacks before a different model/view can receive a late picker completion.
  useLayoutEffect(() => {
    activePick.current = null;
    setPicking(false);
    setPickFailed(false);
    return () => {
      activePick.current = null;
    };
  }, [model]);
  const discardSelection = useCallback(() => {
    activePick.current = null;
    setPicking(false);
    setPickFailed(false);
  }, []);
  const send = useCallback(async () => {
    await model.send();
  }, [model]);
  const attach = useCallback(async () => {
    const selection = Symbol("image-selection");
    activePick.current = selection;
    setPickFailed(false);
    setPicking(true);
    try {
      const picked = await pickImages();
      if (activePick.current === selection && picked.length > 0)
        model.setImages([...model.getSnapshot().images, ...picked]);
    } catch {
      if (activePick.current === selection) setPickFailed(true);
    } finally {
      if (activePick.current === selection) {
        activePick.current = null;
        setPicking(false);
      }
    }
  }, [model, pickImages]);
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
  useEffect(() => {
    if (state.submission.kind === "accepted" && model.getSnapshot() === state) {
      editor.current?.replaceText(state.text);
    }
  }, [model, state]);
  if (state.availability === "subagent") return null;
  const retained = state.submission.kind === "unknown" ? state.submission.images : [];
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
            editable={state.submission.kind !== "unknown"}
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
          loading={picking}
          disabled={
            state.availability !== "ready" || state.submission.kind === "unknown" || picking
          }
          onPress={attach}
          accessibilityLabel={t("nativeDsh.composer.attach")}
          testID="dsh-prompt-attach"
        >
          {t("nativeDsh.composer.attach")}
        </Button>
        {picking && (
          <Button
            size="sm"
            variant="ghost"
            onPress={discardSelection}
            testID="dsh-prompt-discard-selection"
          >
            {t("nativeDsh.composer.discardSelection")}
          </Button>
        )}
        {pickFailed && (
          <Text style={styles.error} accessibilityRole="alert" testID="dsh-prompt-attach-failed">
            {t("nativeDsh.composer.attachFailed")}
          </Text>
        )}

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
                  disabled={state.submission.kind === "unknown"}
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
      <Button disabled={!state.canSend || picking} onPress={send} testID="dsh-prompt-send">
        {state.submission.kind === "sending"
          ? t("nativeDsh.composer.sending")
          : t("nativeDsh.composer.send")}
      </Button>
    </View>
  );
}
