import { describe, expect, it } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId, SessionListState, WorkspaceId } from "@deepseek-ai/dsh-client";
import { workspaceOverview, type WorkspaceOverviewItem } from "./workspace-overview";

const sid = (value: string) => brandString<SessionId>(value);
const workspaceId = brandString<WorkspaceId>("workspace-a");
const workspace: WorkspaceOverviewItem = {
  workspaceId,
  title: "Release",
  path: "/release",
  sessionIds: [sid("idle"), sid("pending"), sid("missing"), sid("archived"), sid("child")],
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
};
const state = {
  items: [workspace],
  archivedSessionIds: [sid("archived")],
  phase: "ready" as const,
  state: "idle" as const,
  error: null,
};
function session(id: string, running = false): SessionListState["byId"][SessionId] {
  return { id: sid(id), displayTitle: id, running, blank: false, updatedAt: 1 };
}
const sessions = {
  ids: [sid("unrelated"), sid("pending"), sid("idle"), sid("archived"), sid("child")],
  byId: {
    unrelated: session("unrelated"),
    pending: session("pending", true),
    idle: session("idle"),
    archived: session("archived"),
    child: { ...session("child"), origin: "subagent" as const },
  },
};

describe("workspace overview", () => {
  it("preserves explicit membership order and exposes unloaded members without duplicating child work", () => {
    const overview = workspaceOverview(state, sessions, workspaceId, (id) => id === sid("pending"));
    expect(overview.activity.map((item) => [item.session.id, item.status])).toEqual([
      ["idle", "idle"],
      ["pending", "waiting"],
    ]);
    expect(overview.unloaded).toBe(1);
    expect(overview.removed).toBe(false);
  });

  it("keeps ungrouped history reachable from all workspaces", () => {
    const overview = workspaceOverview(state, sessions, null, () => false);
    expect(overview.activity.map((item) => item.session.id)).toEqual([
      "unrelated",
      "pending",
      "idle",
    ]);
    expect(overview.workspace).toBeNull();
  });

  it("distinguishes a removed registration from an unloaded baseline", () => {
    expect(
      workspaceOverview(
        { ...state, items: [], phase: "pending" },
        sessions,
        workspaceId,
        () => false,
      ).removed,
    ).toBe(false);
    expect(workspaceOverview({ ...state, items: [] }, sessions, workspaceId, () => false)).toEqual({
      workspace: null,
      removed: true,
      activity: [],
      unloaded: 0,
    });
  });
});
