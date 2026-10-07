import { useFetchQuery } from "@/data/query";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { DshConversation, DshHostRuntime } from "../runtime";
import { featureAvailable, remoteValue } from "../features";
import { styles } from "./styles";
export function WorkspaceFiles({
  runtime,
  view,
}: {
  runtime: DshHostRuntime;
  view: DshConversation;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [offset, setOffset] = useState(1);
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const available = featureAvailable(runtime, ["workspaceFiles/list", "workspaceFiles/read"]);
  const listing = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["dsh-files", runtime.hostId, view.sessionId, path, generation],
    enabled: available && file === null,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) =>
      remoteValue(await runtime.remote.workspaceFiles.list(view.sessionId, path, signal)),
  });
  const content = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["dsh-file", runtime.hostId, view.sessionId, file, offset, generation],
    enabled: available && file !== null,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      if (file === null) throw new Error("no-file");
      return remoteValue(
        await runtime.remote.workspaceFiles.read(view.sessionId, file, { offset }, signal),
      );
    },
  });
  const back = useCallback(() => {
    if (file !== null) {
      setFile(null);
      setOffset(1);
    } else setPath(path.split("/").slice(0, -1).join("/"));
  }, [file, path]);
  const more = useCallback(() => {
    if (content.data !== undefined) setOffset(content.data.offset + content.data.lines);
  }, [content.data]);
  const choose = useCallback(
    (name: string, directory: boolean) => {
      const next = path === "" ? name : `${path}/${name}`;
      if (directory) setPath(next);
      else {
        setFile(next);
        setOffset(1);
      }
    },
    [path],
  );
  return (
    <View style={styles.group} testID="dsh-workspace-files">
      <Text style={styles.title}>{t("nativeDsh.features.files")}</Text>
      {!available && <Text style={styles.muted}>{t("nativeDsh.features.unavailable")}</Text>}
      {(path !== "" || file !== null) && (
        <Button variant="ghost" onPress={back}>
          {t("common.actions.back")}
        </Button>
      )}
      <Text selectable style={styles.muted}>
        {file ?? path}
      </Text>
      {file === null &&
        listing.data?.entries.map((entry) => (
          <FileEntry key={entry.name} name={entry.name} type={entry.type} choose={choose} />
        ))}
      {listing.data?.truncated && file === null && (
        <Text style={styles.muted}>{t("nativeDsh.files.truncated")}</Text>
      )}
      {file !== null && content.data !== undefined && (
        <>
          <Text selectable style={styles.message}>
            {content.data.text}
          </Text>
          {!content.data.eof && <Button onPress={more}>{t("nativeDsh.loadMore")}</Button>}
        </>
      )}
      {(listing.isFetching || content.isFetching) && (
        <Text style={styles.muted}>{t("common.loading")}</Text>
      )}
      {(listing.isError || content.isError) && (
        <Text style={styles.error}>{t("nativeDsh.files.failed")}</Text>
      )}
    </View>
  );
}
function FileEntry({
  name,
  type,
  choose,
}: {
  name: string;
  type: "directory" | "file" | "other";
  choose(name: string, directory: boolean): void;
}) {
  const select = useCallback(() => choose(name, type === "directory"), [choose, name, type]);
  return (
    <Button variant="ghost" disabled={type === "other"} onPress={select}>
      {type === "directory" ? `${name}/` : name}
    </Button>
  );
}
