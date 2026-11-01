import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollView } from "react-native";
import type { DshDirectory, DshDirectorySnapshot } from "../directory";
import type { DshHostRuntime } from "../runtime";
import { Sessions } from "./sessions";
import { AccessError } from "./host-pairing";
import { styles } from "./styles";

export function WorkspaceScreen({
  model,
  state,
  runtime,
  onManageHosts,
}: {
  model: DshDirectory;
  state: DshDirectorySnapshot;
  runtime: DshHostRuntime;
  onManageHosts: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.overviewContent}>
      {state.error !== null && <AccessError code={state.error} />}
      <Sessions model={model} runtime={runtime} busy={state.busy} onManageHosts={onManageHosts} />
    </ScrollView>
  );
}

export function WorkspaceReturn({ active, onPress }: { active: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <Button size="sm" variant="ghost" onPress={onPress}>
      {t("nativeDsh.workspaceOverview.back")}
    </Button>
  );
}
