import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ScreenHeader } from "@/components/headers/screen-header";
import { Button } from "@/components/ui/button";
import type { DshDirectory } from "../directory";
import { useSnapshot } from "./use-snapshot";

export function ProductHeader({ model }: { model: DshDirectory | null }) {
  const { t } = useTranslation();
  const left = useMemo(
    () => (
      <View style={styles.identity}>
        <Text style={styles.brand}>{t("nativeDsh.product.name")}</Text>
        <Text style={styles.section}>{t("nativeDsh.product.workspace")}</Text>
      </View>
    ),
    [t],
  );
  const right = useMemo(
    () => (model === null ? undefined : <ConnectionControl model={model} />),
    [model],
  );
  return <ScreenHeader left={left} right={right} />;
}

function ConnectionControl({ model }: { model: DshDirectory }) {
  const { t } = useTranslation();
  const state = useSnapshot(model);
  const open = useCallback(() => model.manageHosts(!model.getSnapshot().managingHosts), [model]);
  if (state.runtime === null) return null;
  return (
    <Button size="sm" variant="ghost" disabled={state.busy} onPress={open} testID="dsh-connections">
      {t(
        state.managingHosts ? "nativeDsh.workspaceOverview.back" : "nativeDsh.product.connections",
      )}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  identity: { flexDirection: "row", alignItems: "center", gap: theme.spacing[4], minWidth: 0 },
  brand: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  section: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
