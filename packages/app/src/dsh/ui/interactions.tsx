import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { PendingQuestion, SessionPendingInteraction } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { DshConversation, DshHostRuntime } from "../runtime";
import { DshInteractionForm, type DshQuestionDraft } from "../interaction-form";
import { Composer } from "./composer";
import { styles } from "./styles";

interface OptionProps {
  option: NonNullable<PendingQuestion["questions"][number]["options"]>[number];
  selected: boolean;
  disabled: boolean;
  choose(label: string): void;
}
function Option({ option, selected, disabled, choose }: OptionProps) {
  const press = useCallback(() => choose(option.label), [choose, option.label]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <View style={styles.group}>
      <Button
        variant={selected ? "default" : "outline"}
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPress={press}
      >
        {option.label}
      </Button>
      {option.description !== undefined && <Text style={styles.muted}>{option.description}</Text>}
    </View>
  );
}

interface QuestionFieldProps {
  form: DshInteractionForm;
  question: PendingQuestion["questions"][number];
  index: number;
  draft: DshQuestionDraft;
  disabled: boolean;
}

function QuestionField({ form, question, index, draft, disabled }: QuestionFieldProps) {
  const { t } = useTranslation();
  const editor = useRef<EditingTextInputHandle>(null);
  const choose = useCallback(
    (label: string) => {
      form.select(index, label);
      editor.current?.replaceText(form.getSnapshot().drafts[index].custom);
    },
    [form, index],
  );
  const skip = useCallback(() => {
    form.skip(index);
    editor.current?.replaceText(form.getSnapshot().drafts[index].custom);
  }, [form, index]);
  const setText = useCallback((text: string) => form.setText(index, text), [form, index]);
  const accessibilityState = useMemo(() => ({ selected: draft.skipped }), [draft.skipped]);
  return (
    <View style={styles.group}>
      {question.header !== undefined && <Text style={styles.title}>{question.header}</Text>}
      <Text style={styles.text}>{question.question}</Text>
      {question.detail !== undefined && (
        <Text selectable style={styles.message}>
          {question.detail}
        </Text>
      )}
      {question.options?.map((option) => (
        <Option
          key={option.label}
          option={option}
          selected={draft.selected.includes(option.label)}
          disabled={disabled}
          choose={choose}
        />
      ))}
      <Field label={t("nativeDsh.interactions.custom")}>
        <FormTextInput
          ref={editor}
          initialValue={draft.custom}
          onChangeText={setText}
          editable={!disabled}
          multiline
          numberOfLines={6}
          size="md"
          accessibilityLabel={`${question.question} — ${t("nativeDsh.interactions.custom")}`}
          testID={`dsh-answer-${index}`}
        />
      </Field>
      <Button
        variant="ghost"
        disabled={disabled}
        onPress={skip}
        accessibilityState={accessibilityState}
      >
        {draft.skipped ? t("nativeDsh.interactions.skipped") : t("nativeDsh.interactions.skip")}
      </Button>
    </View>
  );
}

function Interaction({ form }: { form: DshInteractionForm }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const request = form.request;
  const allow = useCallback(() => form.approve("allowed-once"), [form]);
  const reject = useCallback(() => form.approve("rejected"), [form]);
  const submit = useCallback(() => form.submit(), [form]);
  const cancel = useCallback(() => form.cancel(), [form]);
  const disabled = state.status !== "editing";
  return (
    <View style={[styles.content, styles.composer]} testID="dsh-interaction">
      <ScrollView
        style={styles.composerFields}
        contentContainerStyle={styles.group}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t(`nativeDsh.interactions.${request.kind}`)}</Text>
        {request.kind === "approval" ? (
          <View style={styles.group}>
            <Text selectable style={styles.text}>
              {request.toolName}
            </Text>
            {request.reason !== undefined && (
              <Text selectable style={styles.message}>
                {request.reason}
              </Text>
            )}
          </View>
        ) : (
          request.questions.map((question, index) => (
            <QuestionField
              key={question.id}
              form={form}
              question={question}
              index={index}
              draft={state.drafts[index]}
              disabled={disabled}
            />
          ))
        )}
        {state.status === "failed" && (
          <Text style={styles.error} accessibilityRole="alert">
            {t("nativeDsh.interactions.failed")}
          </Text>
        )}
        {state.status === "settling" && (
          <Text style={styles.muted} accessibilityLiveRegion="polite">
            {t("nativeDsh.interactions.settling")}
          </Text>
        )}
        {state.status === "settled" && (
          <Text style={styles.muted} accessibilityLiveRegion="polite">
            {t("nativeDsh.interactions.settled")}
          </Text>
        )}
      </ScrollView>
      {request.kind === "approval" ? (
        <View style={styles.actions}>
          <Button disabled={disabled} onPress={allow} testID="dsh-approval-allow">
            {t("nativeDsh.interactions.allow")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onPress={reject}
            testID="dsh-approval-reject"
          >
            {t("nativeDsh.interactions.reject")}
          </Button>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button disabled={!state.canSubmit} onPress={submit} testID="dsh-question-submit">
            {t("nativeDsh.interactions.submit")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onPress={cancel}
            testID="dsh-question-cancel"
          >
            {t("nativeDsh.interactions.cancel")}
          </Button>
        </View>
      )}
    </View>
  );
}

interface SessionComposerProps {
  runtime: DshHostRuntime;
  view: DshConversation;
  forms: WeakMap<SessionPendingInteraction, DshInteractionForm>;
}

/** Drafts are keyed by the shared request object so priority changes retain unfinished answers. */
export function SessionComposer({ runtime, view, forms }: SessionComposerProps) {
  const pending = useSyncExternalStore(runtime.pending.subscribe, runtime.pending.getSnapshot);
  const request = pending.get(view.sessionId);
  if (request === undefined) return <Composer model={view.prompt} />;
  let form = forms.get(request);
  if (form === undefined) {
    form = new DshInteractionForm(request);
    forms.set(request, form);
  }
  return <Interaction key={request.key} form={form} />;
}
