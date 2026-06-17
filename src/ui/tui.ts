/**
 * Live terminal progress panel for a workflow run.
 *
 * `renderWorkflowTUI(meta)` returns an `onEvent` you pass to runWorkflow and a
 * `stop()` to tear the panel down. State is owned by a shared `createPanelReducer`
 * (events → PanelState); this file owns ONLY the terminal lifecycle — the
 * pi-tui mount, the animation timer, and the non-TTY fallback print.
 *
 * pi-tui is imported DYNAMICALLY so the core library never hard-depends on it:
 * if it isn't installed (or stdout is not a TTY), the panel degrades to plain
 * console lines via the same renderer. This is the ONLY file in the UI module
 * that touches pi-tui or `process.stdout`.
 */

import type { WorkflowEvent, WorkflowMeta } from "../types.ts";
import { renderPanel } from "./render-ansi.ts";
import { createPanelReducer } from "./reducer.ts";

export interface WorkflowTUI {
  onEvent: (event: WorkflowEvent) => void;
  stop: () => void;
}

interface PiTui {
  TUI: new (terminal: unknown) => {
    addChild(c: { render(width: number): string[] }): void;
    requestRender(): void;
    start(): void;
    stop(): void;
  };
  ProcessTerminal: new () => unknown;
}

export async function renderWorkflowTUI(
  meta?: WorkflowMeta,
  nowMs = () => Date.now(),
): Promise<WorkflowTUI> {
  const reducer = createPanelReducer(meta, nowMs);

  // ── pi-tui (optional) ──
  let tui: InstanceType<PiTui["TUI"]> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  if (process.stdout.isTTY) {
    try {
      const mod = (await import("@earendil-works/pi-tui")) as unknown as PiTui;
      tui = new mod.TUI(new mod.ProcessTerminal());
      tui.addChild({ render: (w) => renderPanel(reducer.getState(), w) });
      tui.start();
      timer = setInterval(() => tui?.requestRender(), 120); // animate clocks
    } catch {
      tui = undefined;
    }
  }
  const redraw = () => tui?.requestRender();

  const onEvent = (event: WorkflowEvent): void => {
    reducer.onEvent(event);
    redraw();
  };

  const stop = (): void => {
    if (timer) clearInterval(timer);
    if (tui) {
      tui.requestRender();
      tui.stop();
    } else {
      // Non-TTY: print the final frame once.
      for (const line of renderPanel(reducer.getState())) console.log(line);
    }
  };

  return { onEvent, stop };
}
