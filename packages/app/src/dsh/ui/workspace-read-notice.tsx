import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { WorkspaceReading } from "../workspace-data";
import { workspaceStyles as ws } from "./workspace-styles";
import { styles } from "./styles";

export function WorkspaceReadNotice({
  status,
  onRetry,
  failureMessage,
}: {
  status: WorkspaceReading<unknown>["status"];
  onRetry?: () => void;
  failureMessage?: string;
}) {
  const { t } = useTranslation();
  if (status === "ready" || status === "idle") return null;
  return (
    <View style={ws.empty}>
      <Text
        accessibilityRole={status === "failed" ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={status === "failed" ? styles.error : ws.muted}
      >
        {status === "failed" && failureMessage !== undefined
          ? failureMessage
          : t(
              status === "select-workspace"
                ? "nativeDsh.workspaceData.selectWorkspace"
                : `nativeDsh.workspaceData.${status}`,
            )}
      </Text>
      {status === "failed" && onRetry !== undefined && (
        <Button variant="ghost" size="sm" onPress={onRetry}>
          {t("nativeDsh.workspaceData.refresh")}
        </Button>
      )}
    </View>
  );
}
