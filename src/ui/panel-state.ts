/**
 * Shared panel data shapes for pi-loom's progress UI.
 *
 * `PanelState` is the single contract that ties the three UI tiers together:
 * the reducer (events → PanelState) produces it, and both renderers
 * (ANSI terminal, HTML web) consume it. It is plain JSON (strings / numbers /
 * arrays only — no Map, no Date), so a host may also ship it over the wire
 * (SSE / WebSocket) and render in the browser.
 *
 * No imports on purpose: this is the dependency-free root of the UI module.
 */

export type PhaseStatus = "done" | "active" | "pending";
export interface PhaseRow {
  title: string;
  status: PhaseStatus;
  done: number;
  total: number;
  /** The sub-agents that belong to this phase, nested so the panel renders one
   *  full tree (every phase with its agents) instead of only the active phase. */
  agents: AgentRow[];
}

export type AgentStatus = "running" | "done" | "failed";
export interface AgentRow {
  label: string;
  status: AgentStatus;
  model?: string;
  tokens: number;
  tools?: number;
  elapsedMs?: number;
}

export interface PanelState {
  name: string;
  description?: string;
  /** The full plan as a tree: each phase carries its own agents. */
  phases: PhaseRow[];
  /** Title of the phase currently executing (for highlighting). */
  activePhase: string;
  agentsDone: number;
  agentsTotal: number;
  elapsedMs: number;
}
