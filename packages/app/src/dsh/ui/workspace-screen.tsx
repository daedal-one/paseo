import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import type { DshDirectory, DshDirectorySnapshot } from "../directory";
import type { DshHostRuntime } from "../runtime";
import { Sessions } from "./sessions";
import { AccessError } from "./host-pairing";
import { styles } from "./styles";

export function WorkspaceScreen({
  model,
  state,
  runtime,
}: {
  model: DshDirectory;
  state: DshDirectorySnapshot;
  runtime: DshHostRuntime;
}) {
  return (
    <ScrollView contentContainerStyle={styles.overviewContent}>
      {state.error !== null && <AccessError code={state.error} />}
      <Sessions model={model} runtime={runtime} busy={state.busy} />
    </ScrollView>
  );
}

/** Keep an active execution mounted while its connection details are visible. */
export function DirectoryView({
  model,
  state,
  conversation,
  children,
}: {
  model: DshDirectory;
  state: DshDirectorySnapshot;
  conversation: ReactNode;
  children: ReactNode;
}) {
  const active = state.runtime !== null && state.pairing.status === "idle";
  return (
    <View style={styles.fill}>
      {active && state.runtime !== null && (
        <View style={[styles.fill, state.managingHosts && styles.hidden]}>
          {conversation ?? <WorkspaceScreen model={model} state={state} runtime={state.runtime} />}
        </View>
      )}
      {(!active || state.managingHosts) && children}
    </View>
  );
}
