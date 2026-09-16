import { useCallback, useRef, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { DshPrompt } from "../prompt";
import { styles } from "./styles";

export function Composer({ model }: { model: DshPrompt }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const editor = useRef<EditingTextInputHandle>(null);
  const send = useCallback(async () => {
    if (await model.send()) editor.current?.replaceText(model.getSnapshot().text);
  }, [model]);
  if (state.availability === "subagent") return null;
  return (
    <View style={styles.group} testID="dsh-composer">
      <Field label={t("nativeDsh.composer.label")}>
        <FormTextInput
          ref={editor}
          initialValue={state.text}
          onChangeText={model.setText}
          editable={state.submission.kind !== "unknown"}
          multiline
          size="md"
          accessibilityLabel={t("nativeDsh.composer.label")}
          placeholder={t("nativeDsh.composer.placeholder")}
          testID="dsh-prompt-text"
        />
      </Field>
      <Button disabled={!state.canSend} onPress={send} testID="dsh-prompt-send">
        {state.submission.kind === "sending"
          ? t("nativeDsh.composer.sending")
          : t("nativeDsh.composer.send")}
      </Button>
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
    </View>
  );
}
