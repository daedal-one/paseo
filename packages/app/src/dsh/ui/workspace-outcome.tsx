import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ChatNode } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import { styles } from "./styles";

/** Present the shared workspace receipt independently of agent completion. */
export function WorkspaceOutcome({ node }: { node: ChatNode<"workspace-state"> }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleDetails = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const { phase, branches, error } = node.data;
  if (phase === "ready") return null;
  const detailsLabel = expanded ? "nativeDsh.workspace.hideDetails" : "nativeDsh.workspace.details";
  return (
    <View style={styles.group} testID="dsh-workspace-outcome">
      <Text role="status" style={styles.title}>
        {t(`nativeDsh.workspace.${phase}`)}
      </Text>
      {phase === "returned" &&
        Object.keys(branches).map((branch) => (
          <Text key={branch} selectable style={styles.text}>
            {branch.replace(/^refs\/heads\//u, "")}
          </Text>
        ))}
      {error !== undefined && (
        <View style={styles.group}>
          <Button
            variant="secondary"
            accessibilityState={accessibilityState}
            onPress={toggleDetails}
          >
            {t(detailsLabel)}
          </Button>
          {expanded && (
            <ScrollView style={styles.detail} nestedScrollEnabled testID="dsh-workspace-error">
              <Text selectable style={styles.text}>
                {error}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
