/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import { selectRemoteCapabilities } from "@deepseek-ai/dsh-client";
import type {
  ConnectionHandle,
  ConnectionHostId,
  HostCapabilities,
  ISessions,
  IWorkspaces,
  SessionId,
  WorkspaceId,
} from "@deepseek-ai/dsh-client";
import { i18n } from "@/i18n/i18next";
import { createSqliteCreationStorage } from "../creation-storage-sqlite";
import { DshFork } from "../fork";
import { DshForkJournal } from "../fork-journal";
import type { DshHostRuntime } from "../runtime";
import { ForkControl } from "./fork-sheet";

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = ({
    visible,
    header,
    children,
    footer,
    onClose,
    testID,
  }: {
    visible: boolean;
    header: { title: string };
    children: React.ReactNode;
    footer?: React.ReactNode;
    onClose: () => void;
    testID?: string;
  }) => {
    if (!visible) return null;
    return ReactModule.createElement(
      "div",
      { "data-testid": testID ?? "adaptive-modal-sheet", "data-modal-title": header.title },
      ReactModule.createElement(
        "button",
        { type: "button", "data-testid": "adaptive-modal-sheet-close", onClick: onClose },
        "Close",
      ),
      children,
      footer === undefined
        ? null
        : ReactModule.createElement("div", { "data-testid": "sheet-footer" }, footer),
    );
  };
  const AdaptiveTextInput = ReactModule.forwardRef<HTMLInputElement, Record<string, unknown>>(
    (props, ref) => {
      const p = props as {
        initialValue?: string;
        defaultValue?: string;
        editable?: boolean;
        testID?: string;
        accessibilityLabel?: string;
        onChangeText?: (next: string) => void;
      };
      return ReactModule.createElement("input", {
        ref,
        defaultValue: p.initialValue ?? p.defaultValue ?? "",
        disabled: p.editable === false,
        "data-testid": p.testID,
        "aria-label": p.accessibilityLabel,
        onChange: (e: { target: { value: string } }) => p.onChangeText?.(e.target.value),
      });
    },
  );
  return { AdaptiveModalSheet, AdaptiveTextInput };
});

function cell<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set(next: T) {
      value = next;
      for (const fn of listeners) fn();
    },
  };
}
const sid = (value: string) => brandString<SessionId>(value);
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("host-a"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>("activation-a"),
};
const owners: DshFork[] = [];
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()));
});

function sqliteStorage(file: string) {
  return createSqliteCreationStorage(async () => {
    const db = new DatabaseSync(file);
    return {
      async exec(sql: string) {
        db.exec(sql);
      },
      async run(sql: string, params: string[]) {
        db.prepare(sql).run(...params);
      },
      async get(sql: string, params: string[]) {
        return (db.prepare(sql).get(...params) as { payload: string } | undefined) ?? null;
      },
      async close() {
        db.close();
      },
    };
  });
}

function emptyList() {
  return {
    phase: "ready" as const,
    ids: [] as SessionId[],
    byId: {},
    current: undefined,
    hasMore: false,
    loadingMore: false,
    state: "idle" as const,
    error: null,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  };
}

/** One cold runtime over the same database file, as a restarted worker would build it. */
function coldRuntime(
  file: string,
  options: {
    online: boolean;
    child?: SessionId;
    parent?: string;
    workspace?: string;
    failDispatch?: boolean;
  },
) {
  const generation = cell<ReturnType<ConnectionHandle["generation"]["getSnapshot"]>>(
    options.online ? { id: 1, host: { home: "/fixture", identity } } : undefined,
  );
  const capabilities: HostCapabilities = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(["session/forkTo"]).map((value) =>
      Object.assign({}, value, { availability: "available" as const }),
    ),
  };
  const child = options.child ?? null;
  const list = cell(
    child === null
      ? emptyList()
      : {
          ...emptyList(),
          ids: [child],
          byId: {
            [child]: {
              id: child,
              parentId: sid(options.parent ?? "source"),
              displayTitle: "Current child",
              running: false,
              blank: false,
              updatedAt: 1,
            },
          },
        },
  );
  const workspaceId = options.workspace;
  const workspacesList = cell<ReturnType<IWorkspaces["list"]["getSnapshot"]>>({
    phase: "ready",
    items:
      workspaceId === undefined
        ? []
        : [
            {
              workspaceId: brandString<WorkspaceId>(workspaceId),
              path: "/host/project",
              title: "Project",
              sessionIds: child === null ? [] : [child],
              createdAt: "2026-09-22T00:00:00.000Z",
              updatedAt: "2026-09-22T00:00:00.000Z",
            },
          ],
    archivedSessionIds: [],
    state: "idle",
    error: null,
  });
  const sessions = {
    list,
    forkTo: vi.fn<ISessions["forkTo"]>(async (request) => {
      if (options.failDispatch === true) throw new Error("reply lost");
      return request.childSessionId;
    }),
    loadSummary: vi.fn<ISessions["loadSummary"]>(async () => ({ ok: true, value: true })),
  };
  const workspaces = { list: workspacesList };
  let sequence = 0;
  const fork = new DshFork(
    sessions,
    workspaces,
    { generation },
    () => capabilities,
    () => sid(`child-${++sequence}`),
    new DshForkJournal(identity.hostId, sqliteStorage(file)),
  );
  owners.push(fork);
  const runtime = { fork, workspaces } as unknown as DshHostRuntime;
  return { runtime, fork, sessions, workspacesList };
}

let container: HTMLDivElement;
let root: Root;
let home: string;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  home = await mkdtemp(join(tmpdir(), "dsh-fork-cold-"));
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  await rm(home, { recursive: true, force: true });
});

function element<T extends HTMLElement>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Missing fork control: ${selector}`);
  return found;
}
function click(selector: string): void {
  act(() => element(selector).click());
}
function render(runtime: DshHostRuntime) {
  act(() => root.render(<ForkControl runtime={runtime} sessionId={sid("source")} busy={false} />));
}
function typeAnchor(value: string): void {
  const input = element<HTMLInputElement>("[data-testid=dsh-fork-anchor]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Input value setter unavailable");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("visible fork cold recovery over real SQLite", () => {
  it("restores a confirmed fork from a fresh connection and never redispatchhes it", async () => {
    const file = join(home, "fork.db");
    const first = coldRuntime(file, { online: true });
    await act(async () => {
      await first.fork.restore();
    });
    render(first.runtime);
    click("[data-testid=dsh-fork-session]");
    typeAnchor("5");
    click("[data-testid=dsh-fork-submit]");
    await expect.poll(() => first.sessions.forkTo.mock.calls.length).toBe(1);
    expect(first.runtime.fork.getSnapshot().outcome.kind).toBe("confirmed");
    act(() => root.unmount());
    root = createRoot(container);

    // A replaced runtime over the same file, offline, must still show the retained attempt.
    const second = coldRuntime(file, { online: false });
    await act(async () => {
      await second.fork.restore();
    });
    render(second.runtime);
    expect(element("[data-testid=dsh-fork-session]").textContent).toBe("Review fork");
    click("[data-testid=dsh-fork-session]");
    expect(element("[data-testid=dsh-fork-outcome-confirmed]")).toBeTruthy();
    expect(element("[data-testid=dsh-fork-request-child]").textContent).toBe("child-1");
    expect(element("[data-testid=dsh-fork-request-anchor]").textContent).toBe("5");
    expect(container.querySelector("[data-testid=dsh-fork-submit]")).toBeNull();
    expect(second.sessions.forkTo).not.toHaveBeenCalled();
  });

  it("keeps an unconfirmed attempt across restart and refuses the wrong child", async () => {
    const file = join(home, "fork.db");
    const first = coldRuntime(file, { online: true, failDispatch: true });
    await act(async () => {
      await first.fork.restore();
    });
    render(first.runtime);
    click("[data-testid=dsh-fork-session]");
    click("[data-testid=dsh-fork-submit]");
    await expect.poll(() => first.sessions.forkTo.mock.calls.length).toBe(1);
    act(() => root.unmount());
    root = createRoot(container);

    const second = coldRuntime(file, {
      online: true,
      child: sid("child-1"),
      parent: "someone-else",
    });
    await act(async () => {
      await second.fork.restore();
    });
    render(second.runtime);
    click("[data-testid=dsh-fork-session]");
    expect(element("[data-testid=dsh-fork-outcome-unknown]")).toBeTruthy();
    click("[data-testid=dsh-fork-check]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-lookup-mismatch]"))
      .not.toBeNull();
    expect(container.querySelector("[data-testid=dsh-fork-adopt]")).toBeNull();
    expect(second.sessions.forkTo).not.toHaveBeenCalled();
  });

  it("adopts the matching child after a restart and shows current Workspace membership", async () => {
    const file = join(home, "fork.db");
    const first = coldRuntime(file, { online: true, failDispatch: true });
    await act(async () => {
      await first.fork.restore();
    });
    render(first.runtime);
    click("[data-testid=dsh-fork-session]");
    click("[data-testid=dsh-fork-submit]");
    await expect.poll(() => first.sessions.forkTo.mock.calls.length).toBe(1);
    act(() => root.unmount());
    root = createRoot(container);

    const second = coldRuntime(file, {
      online: true,
      child: sid("child-1"),
      workspace: "workspace-1",
    });
    await act(async () => {
      await second.fork.restore();
    });
    render(second.runtime);
    click("[data-testid=dsh-fork-session]");
    click("[data-testid=dsh-fork-check]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-child-id]"))
      .not.toBeNull();
    expect(element("[data-testid=dsh-fork-child-parent]").textContent).toContain("source");
    expect(element("[data-testid=dsh-fork-workspaces]").textContent).toContain("Project");
    click("[data-testid=dsh-fork-adopt]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-outcome-adopted]"))
      .not.toBeNull();
    expect(second.sessions.forkTo).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);

    // Adoption is terminal and durable across another restart.
    const third = coldRuntime(file, { online: true });
    await act(async () => {
      await third.fork.restore();
    });
    expect(third.runtime.fork.getSnapshot().outcome.kind).toBe("adopted");
    render(third.runtime);
    click("[data-testid=dsh-fork-session]");
    expect(element("[data-testid=dsh-fork-outcome-adopted]")).toBeTruthy();
    expect(third.sessions.forkTo).not.toHaveBeenCalled();
  });
});
