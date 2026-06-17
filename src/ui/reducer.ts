/**
 * The panel reducer: pure "events → PanelState" state machine.
 *
 * This is the heart shared by all three UI tiers. It owns ONLY the progress
 * state derived from the workflow event stream — no terminal, no pi-tui, no DOM,
 * no `process`. A terminal controller (tui.ts) and a web host both drive it the
 * same way: feed each WorkflowEvent to `onEvent`, then read `getState()` to
 * render however they like.
 *
 * Determinism: the clock is injected (`nowMs`, default `Date.now`). `elapsedMs`
 * for the whole run is computed live inside `getState()`; each agent's
 * `elapsedMs` is a snapshot frozen at `agent_end` (a running agent has none).
 * This mirrors the original buildState() exactly, so fake-clock tests are
 * byte-stable.
 */

import type { WorkflowEvent, WorkflowMeta } from "../types.ts";
import type { PanelState, PhaseRow, AgentRow, PhaseStatus } from "./panel-state.ts";

interface LiveAgent extends AgentRow {
  phase: string;
  startMs: number;
}

export interface PanelReducer {
  /** Fold one workflow event into the panel state. */
  onEvent: (event: WorkflowEvent) => void;
  /** Snapshot the current panel state (elapsedMs computed live via nowMs). */
  getState: () => PanelState;
}

/**
 * Create a panel reducer. `runStart` is captured synchronously at creation
 * (same instant the old renderWorkflowTUI captured it, before any await), so
 * the run clock counts from "reducer created".
 */
export function createPanelReducer(
  meta?: WorkflowMeta,
  nowMs: () => number = () => Date.now(),
): PanelReducer {
  const runStart = nowMs();
  const declaredPhases = meta?.phases?.map((p) => p.title) ?? [];
  const seenPhases: string[] = [...declaredPhases];
  let activePhase = "";
  const agents = new Map<number, LiveAgent>();

  const getState = (): PanelState => {
    const phaseList = seenPhases.length ? seenPhases : activePhase ? [activePhase] : [];
    const activeIdx = phaseList.indexOf(activePhase);
    const phases: PhaseRow[] = phaseList.map((title, i) => {
      const inPhase = [...agents.values()].filter((a) => a.phase === title);
      const done = inPhase.filter((a) => a.status !== "running").length;
      const status: PhaseStatus = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
      const phaseAgents: AgentRow[] = inPhase.map((a) => ({
        label: a.label,
        status: a.status,
        model: a.model,
        tokens: a.tokens,
        tools: a.tools,
        elapsedMs: a.elapsedMs,
      }));
      return { title, status, done, total: inPhase.length, agents: phaseAgents };
    });

    const all = [...agents.values()];
    return {
      name: meta?.name ?? "workflow",
      description: meta?.description,
      phases,
      activePhase,
      agentsDone: all.filter((a) => a.status !== "running").length,
      agentsTotal: all.length,
      elapsedMs: nowMs() - runStart,
    };
  };

  const onEvent = (event: WorkflowEvent): void => {
    switch (event.type) {
      case "phase":
        activePhase = event.title;
        if (!seenPhases.includes(event.title)) seenPhases.push(event.title);
        break;
      case "agent_start":
        agents.set(event.callIndex, {
          label: event.label,
          phase: event.phase,
          status: "running",
          model: event.model,
          tokens: 0,
          startMs: nowMs(),
        });
        break;
      case "agent_end": {
        const a = agents.get(event.callIndex);
        if (a) {
          a.status = event.ok ? "done" : "failed";
          a.tokens = event.outputTokens;
          a.tools = event.tools;
          a.elapsedMs = nowMs() - a.startMs;
        }
        break;
      }
      case "log":
      case "budget":
        break;
    }
  };

  return { onEvent, getState };
}
