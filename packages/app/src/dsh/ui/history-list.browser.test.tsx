import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, afterEach, expect, it } from "vitest";
import { HistoryList } from "./history-list.web";

const previousReact = Reflect.get(globalThis, "React");
beforeAll(() => Reflect.set(globalThis, "React", React));
afterAll(() => {
  if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
  else Reflect.set(globalThis, "React", previousReact);
});
const rowStyle = { height: 80 };
const expandedStyle = { height: 300 };
const renderRow = (key: string) => <div style={rowStyle}>{key}</div>;
const renderExpandedRow = (key: string) => (
  <div style={key === "row-975" ? expandedStyle : rowStyle}>{key}</div>
);
let root: Root;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

it("mounts a bounded row window and preserves a keyed reader across prepends", async () => {
  container = document.createElement("div");
  container.style.cssText = "height:400px;width:390px;display:flex;flex-direction:column";
  document.body.append(container);
  root = createRoot(container);
  const renderItem = renderRow;
  const render = (keys: string[]) =>
    act(() =>
      root.render(<HistoryList keys={keys} renderItem={renderItem} latestLabel="Latest" />),
    );
  const keys = Array.from({ length: 10000 }, (_, i) => `row-${i + 250}`);
  render(keys);
  const scroller = container.querySelector<HTMLElement>("[data-testid=dsh-history-scroll]")!;
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(2);
  await expect.poll(() => container.querySelector('[data-history-key="row-10249"]')).not.toBeNull();
  expect(container.querySelectorAll("[data-history-key]").length).toBeLessThan(40);
  scroller.scrollTop -= 1600;
  scroller.dispatchEvent(new Event("scroll"));
  let key = "";
  let top = 0;
  await expect
    .poll(() => {
      const rows = [...container.querySelectorAll<HTMLElement>("[data-history-key]")];
      const visibleRow = rows.find(
        (row) =>
          row.getBoundingClientRect().top >= scroller.getBoundingClientRect().top &&
          row.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom,
      );
      if (!visibleRow) return false;
      key = visibleRow.dataset.historyKey!;
      top = visibleRow.getBoundingClientRect().top;
      return true;
    })
    .toBe(true);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const held = container.querySelector<HTMLElement>(`[data-history-key="${key}"]`)!;
  top = held.getBoundingClientRect().top;
  render([...Array.from({ length: 250 }, (_, i) => `row-${i}`), ...keys]);
  await expect
    .poll(() => {
      const row = container.querySelector<HTMLElement>(`[data-history-key="${key}"]`);
      return row ? Math.abs(row.getBoundingClientRect().top - top) : Infinity;
    })
    .toBeLessThan(2);
  expect(container.querySelectorAll("[data-history-key]").length).toBeLessThan(40);
});

it("keeps a reader through changing row heights, follows the end only on request and resizes", async () => {
  container = document.createElement("div");
  container.style.cssText = "height:400px;width:1280px;display:flex;flex-direction:column";
  document.body.append(container);
  root = createRoot(container);
  let expanded = false;

  let keys = Array.from({ length: 1000 }, (_, i) => `row-${i}`);
  const render = () =>
    act(() =>
      root.render(
        <HistoryList
          keys={keys}
          renderItem={expanded ? renderExpandedRow : renderRow}
          latestLabel="Latest"
        />,
      ),
    );
  render();
  const scroller = container.querySelector<HTMLElement>("[data-testid=dsh-history-scroll]")!;
  const atEnd = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  await expect.poll(atEnd).toBeLessThan(2);
  scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  scroller.scrollTop -= 1600;
  scroller.dispatchEvent(new Event("scroll"));
  await expect.poll(() => container.querySelector('[data-history-key="row-975"]')).not.toBeNull();
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const visible = [...container.querySelectorAll<HTMLElement>("[data-history-key]")].find(
    (row) =>
      row.getBoundingClientRect().top >= scroller.getBoundingClientRect().top &&
      row.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom,
  )!;
  const key = visible.dataset.historyKey;
  const before = visible.getBoundingClientRect().top;
  expanded = true;
  render();
  await expect
    .poll(
      () =>
        container
          .querySelector<HTMLElement>('[data-history-key="row-975"]')!
          .getBoundingClientRect().height,
    )
    .toBe(300);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await expect
    .poll(() =>
      Math.abs(
        container.querySelector<HTMLElement>(`[data-history-key="${key}"]`)!.getBoundingClientRect()
          .top - before,
      ),
    )
    .toBeLessThan(2);

  keys = [...keys, "row-1000"];
  render();
  await new Promise(requestAnimationFrame);
  await expect
    .poll(() =>
      Math.abs(
        container.querySelector<HTMLElement>(`[data-history-key="${key}"]`)!.getBoundingClientRect()
          .top - before,
      ),
    )
    .toBeLessThan(2);
  const latest = container.querySelector<HTMLElement>('[role="button"]')!;
  latest.click();
  await expect.poll(atEnd).toBeLessThan(2);
  container.style.height = "250px";
  await expect.poll(atEnd).toBeLessThan(2);
  expect(container.querySelectorAll("[data-history-key]").length).toBeLessThan(40);
});
