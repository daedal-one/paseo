import { StyleSheet } from "react-native-unistyles";
export const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: {
    padding: theme.spacing[6],
    gap: theme.spacing[6],
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
  },
  group: { gap: theme.spacing[3] },
  composer: { flexShrink: 1, gap: theme.spacing[3] },
  composerFields: { flexShrink: 1, flexGrow: 0 },
  row: { gap: theme.spacing[2], paddingVertical: theme.spacing[3] },
  actions: { flexDirection: "row", gap: theme.spacing[3], flexWrap: "wrap" },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  text: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  message: { fontSize: theme.fontSize.content, color: theme.colors.foreground },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  error: { fontSize: theme.fontSize.base, color: theme.colors.destructive },
  camera: { height: 300, width: "100%", borderRadius: theme.borderRadius.lg, overflow: "hidden" },
}));
