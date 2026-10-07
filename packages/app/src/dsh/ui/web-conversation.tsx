import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { SessionPendingInteraction } from "@deepseek-ai/dsh-client";
import type { DshDirectory, DshDirectorySnapshot } from "../directory";
import type { DshInteractionForm } from "../interaction-form";
import { AccessError } from "./host-pairing";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Sessions } from "./sessions";
import { Conversation } from "./conversation";
import { SessionComposer } from "./interactions";

export function WebConversation({
  model,
  state,
}: {
  model: DshDirectory;
  state: DshDirectorySnapshot;
}) {
  const compact = useIsCompactFormFactor();
  const [forms] = useState(() => new WeakMap<SessionPendingInteraction, DshInteractionForm>());
  if (state.runtime === null || state.conversation === null) return null;
  return (
    <View style={layout.shell}>
      {!compact && (
        <ScrollView style={layout.sidebar} contentContainerStyle={layout.sidebarContent}>
          <Sessions model={model} runtime={state.runtime} busy={state.busy} />
        </ScrollView>
      )}
      <View style={layout.fill}>
        <View style={layout.fill}>
          {state.error !== null && <AccessError code={state.error} />}
          <Conversation
            key={state.conversation.sessionId}
            model={model}
            runtime={state.runtime}
            view={state.conversation}
            busy={state.busy}
          />
        </View>
        <View style={layout.composer}>
          <SessionComposer runtime={state.runtime} view={state.conversation} forms={forms} />
        </View>
      </View>
    </View>
  );
}
const layout = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, flexDirection: "row" },
  sidebar: { width: 280, flexGrow: 0 },
  sidebarContent: { padding: 16 },
  fill: { flex: 1, minHeight: 0 },
  composer: { flexShrink: 1, maxHeight: "50%" },
});
