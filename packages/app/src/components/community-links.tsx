import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BookOpen, CircleHelp } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "@/utils/open-external-url";

const renderGitHubIcon = (color: string) => <GitHubIcon color={color} size={14} />;

export function CommunityLinks() {
  const { t } = useTranslation();
  const handleOpenGitHub = useCallback(() => {
    void openExternalUrl("https://github.com/daedal-one/paseo");
  }, []);

  const handleOpenHelp = useCallback(() => {
    void openExternalUrl("https://github.com/daedal-one/paseo/blob/main/docs/dsh-companion.md");
  }, []);

  const handleReportIssue = useCallback(() => {
    void openExternalUrl("https://github.com/daedal-one/paseo/issues");
  }, []);

  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={renderGitHubIcon}
        onPress={handleOpenGitHub}
        testID="product-links-source"
      >
        {t("productLinks.source")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={BookOpen}
        onPress={handleOpenHelp}
        testID="product-links-help"
      >
        {t("productLinks.help")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={CircleHelp}
        onPress={handleReportIssue}
        testID="product-links-issues"
      >
        {t("productLinks.reportIssue")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
