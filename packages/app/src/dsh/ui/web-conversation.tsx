import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { SessionPendingInteraction } from "@deepseek-ai/dsh-client";
import type { DshDirectory, DshDirectorySnapshot } from "../directory";
import type { DshInteractionForm } from "../interaction-form";
import { AccessError } from "./host-pairing";
import { Conversation } from "./conversation";
import { SessionComposer } from "./interactions";
import { styles } from "./styles";

export function WebConversation({
  model,
  state,
}: {
  model: DshDirectory;
  state: DshDirectorySnapshot;
}) {
  const [forms] = useState(() => new WeakMap<SessionPendingInteraction, DshInteractionForm>());
  if (state.runtime === null || state.conversation === null) return null;
  return (
    <View style={layout.fill}>
      <ScrollView style={layout.fill} contentContainerStyle={styles.content}>
        {state.error !== null && <AccessError code={state.error} />}
        <Conversation
          model={model}
          runtime={state.runtime}
          view={state.conversation}
          busy={state.busy}
        />
      </ScrollView>
      <View style={layout.composer}>
        <SessionComposer runtime={state.runtime} view={state.conversation} forms={forms} />
      </View>
    </View>
  );
}
const layout = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  composer: { flexShrink: 1, maxHeight: "50%" },
});
