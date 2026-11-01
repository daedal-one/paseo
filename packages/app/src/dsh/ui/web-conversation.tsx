import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { SessionPendingInteraction } from "@deepseek-ai/dsh-client";
import type { DshDirectory, DshDirectorySnapshot } from "../directory";
import type { DshInteractionForm } from "../interaction-form";
import { AccessError } from "./host-pairing";
import { SessionInspector } from "./session-inspector";
import { Conversation } from "./conversation";
import { SessionComposer } from "./interactions";

export function WebConversation({
  model,
  state,
}: {
  model: DshDirectory;
  state: DshDirectorySnapshot;
}) {
  const closeInspector = useCallback(() => model.inspectConversation(false), [model]);
  const [forms] = useState(() => new WeakMap<SessionPendingInteraction, DshInteractionForm>());
  if (state.runtime === null || state.conversation === null) return null;
  return (
    <View style={layout.fill}>
      <View style={[layout.fill, state.inspecting && layout.hidden]}>
        {state.error !== null && <AccessError code={state.error} />}
        <Conversation
          key={state.conversation.sessionId}
          model={model}
          runtime={state.runtime}
          view={state.conversation}
          busy={state.busy}
        />
      </View>
      <View style={[layout.composer, state.inspecting && layout.hidden]}>
        <SessionComposer runtime={state.runtime} view={state.conversation} forms={forms} />
      </View>
      {state.inspecting && (
        <SessionInspector
          key={state.conversation.sessionId}
          runtime={state.runtime}
          view={state.conversation}
          onClose={closeInspector}
        />
      )}
    </View>
  );
}
const layout = StyleSheet.create({
  hidden: { display: "none" },
  fill: { flex: 1, minHeight: 0 },
  composer: { flexShrink: 1, maxHeight: "50%" },
});
