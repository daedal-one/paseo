import { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileText, Folder, Link } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import type { DshHostRuntime } from "../runtime";
import type { DshWorkspaceFiles } from "../workspace-data";
import { useSnapshot } from "./use-snapshot";
import { WorkspaceReadNotice } from "./workspace-read-notice";
import { workspaceStyles as ws } from "./workspace-styles";

export function WorkspaceFiles({
  runtime,
  preview = false,
  onBrowse,
}: {
  runtime: DshHostRuntime;
  preview?: boolean;
  onBrowse?: () => void;
}) {
  const { t } = useTranslation();
  const model = runtime.workspaceData;
  const state = useSnapshot(model);
  const list = state.files;
  const retry = useCallback(() => {
    void model.listFiles("");
  }, [model]);
  const parent = useCallback(() => {
    if (list.status === "ready")
      void model.listFiles(list.value.path.split("/").slice(0, -1).join("/"));
  }, [list, model]);
  const close = useCallback(() => model.closeFile(), [model]);
  return (
    <View style={ws.section} testID="dsh-workspace-files">
      <View style={ws.heading}>
        <Text accessibilityRole="header" style={ws.sectionTitle}>
          {t("nativeDsh.workspaceFiles.title")}
        </Text>
        {preview && onBrowse !== undefined && (
          <Button size="sm" variant="ghost" onPress={onBrowse}>
            {t("nativeDsh.workspaceFiles.browse")}
          </Button>
        )}
      </View>
      <WorkspaceReadNotice status={list.status} onRetry={retry} />
      {list.status === "ready" && (
        <View style={preview ? ws.section : ws.fileColumns}>
          <View style={preview ? ws.section : ws.fileList}>
            {!preview && (
              <View style={ws.actions}>
                {list.value.path !== "" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={ArrowLeft}
                    style={ws.touch}
                    onPress={parent}
                  >
                    {t("nativeDsh.workspaceFiles.parent")}
                  </Button>
                )}
                <Text style={[ws.muted, ws.path]} selectable>
                  {list.value.path || t("nativeDsh.workspaceFiles.root")}
                </Text>
              </View>
            )}
            {list.value.entries.length === 0 && (
              <Text style={ws.muted}>{t("nativeDsh.workspaceFiles.empty")}</Text>
            )}
            {(preview ? list.value.entries.slice(0, 5) : list.value.entries).map((entry) => (
              <WorkspaceFileRow
                key={entry.name}
                entry={entry}
                path={list.value.path}
                runtime={runtime}
                onBrowse={preview ? onBrowse : undefined}
              />
            ))}
            {list.value.truncated && (
              <Text style={ws.muted}>{t("nativeDsh.workspaceFiles.listingTruncated")}</Text>
            )}
          </View>
          {!preview && (
            <View style={ws.filePreview} testID="dsh-workspace-file-preview">
              <WorkspaceReadNotice
                status={state.file.status}
                failureMessage={t("nativeDsh.workspaceFiles.readFailed")}
              />
              {state.file.status === "idle" && (
                <Text style={ws.muted}>{t("nativeDsh.workspaceFiles.noPreview")}</Text>
              )}
              {state.file.status === "ready" && (
                <>
                  <View style={ws.heading}>
                    <Text selectable style={[ws.sectionTitle, ws.path]}>
                      {state.file.value.path}
                    </Text>
                    <Button variant="ghost" size="sm" onPress={close}>
                      {t("nativeDsh.workspaceFiles.close")}
                    </Button>
                  </View>
                  <Text style={ws.muted}>
                    {t("nativeDsh.workspaceFiles.bytes", { count: state.file.value.bytes })}
                  </Text>
                  <ScrollView style={ws.fileContent} nestedScrollEnabled>
                    <ScrollView horizontal nestedScrollEnabled>
                      <Text selectable style={ws.fileCode}>
                        {state.file.value.text}
                      </Text>
                    </ScrollView>
                  </ScrollView>
                  {state.file.value.truncated && (
                    <Text style={ws.muted}>{t("nativeDsh.workspaceFiles.truncated")}</Text>
                  )}
                </>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function WorkspaceFileRow({
  entry,
  path,
  runtime,
  onBrowse,
}: {
  entry: DshWorkspaceFiles["entries"][number];
  path: string;
  runtime: DshHostRuntime;
  onBrowse?: () => void;
}) {
  const open = useCallback(() => {
    const next = path ? `${path}/${entry.name}` : entry.name;
    if (entry.type === "directory") void runtime.workspaceData.listFiles(next);
    else if (entry.type === "file") void runtime.workspaceData.readFile(next);
    onBrowse?.();
  }, [entry, path, runtime, onBrowse]);
  let icon = FileText;
  if (entry.type === "directory") icon = Folder;
  else if (entry.type === "symlink") icon = Link;
  return (
    <Button
      variant="ghost"
      size="sm"
      style={ws.rowButton}
      textStyle={ws.rowButtonText}
      leftIcon={icon}
      disabled={entry.type !== "file" && entry.type !== "directory"}
      onPress={open}
      testID={`dsh-workspace-file-${entry.name}`}
    >
      {entry.name}
    </Button>
  );
}
