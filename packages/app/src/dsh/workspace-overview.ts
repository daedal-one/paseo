import type { SessionId, SessionListState, WorkspaceId } from "@deepseek-ai/dsh-client";
import type { DshHostRuntime } from "./runtime";

type WorkspaceState = ReturnType<DshHostRuntime["workspaces"]["list"]["getSnapshot"]>;
export type WorkspaceOverviewItem = WorkspaceState["items"][number];
export interface WorkspaceActivity {
  session: SessionListState["byId"][SessionId];
  status: "waiting" | "running" | "idle";
}
export interface WorkspaceOverview {
  workspace: WorkspaceOverviewItem | null;
  removed: boolean;
  activity: readonly WorkspaceActivity[];
  unloaded: number;
}

/** Join explicit membership to the loaded listing without inferring identity from paths. */
export function workspaceOverview(
  workspaces: WorkspaceState,
  sessions: Pick<SessionListState, "ids" | "byId">,
  selected: WorkspaceId | null,
  hasPending: (id: SessionId) => boolean,
): WorkspaceOverview {
  const workspace = workspaces.items.find((item) => item.workspaceId === selected) ?? null;
  if (selected !== null && workspace === null) {
    return {
      workspace: null,
      removed: workspaces.phase === "ready" && workspaces.error === null,
      activity: [],
      unloaded: 0,
    };
  }
  const archived = new Set(workspaces.archivedSessionIds);
  const ids = workspace?.sessionIds ?? sessions.ids;
  const activity: WorkspaceActivity[] = [];
  let unloaded = 0;
  for (const id of ids) {
    if (archived.has(id)) continue;
    const session = sessions.byId[id];
    if (session === undefined) {
      unloaded += 1;
      continue;
    }
    if (session.origin === "subagent") continue;
    activity.push({
      session,
      status: activityStatus(hasPending(id), session.running),
    });
  }
  return { workspace, removed: false, activity, unloaded };
}

function activityStatus(pending: boolean, running: boolean): "waiting" | "running" | "idle" {
  if (pending) return "waiting";
  return running ? "running" : "idle";
}
