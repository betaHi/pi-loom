/**
 * pi-loom — public entry point.
 *
 * Clones Claude Code's dynamic-workflow primitives on top of the `pi` harness.
 */

// Re-export TypeBox's `Type` (and types) from pi-ai so schemas use the exact
// same typebox version the runtime validates against.
export { Type } from "@earendil-works/pi-ai";
export type { Static, TSchema } from "@earendil-works/pi-ai";
export type { AgentTool } from "@earendil-works/pi-agent-core";

export * from "./types.ts";

export { runWorkflow } from "./runner/runWorkflow.ts";
export { runWorkflowSource, compileWorkflowScript, extractPhases } from "./runner/runWorkflowSource.ts";

// ── Progress UI: three tiers off one event stream ──
// none → don't subscribe. tui → renderWorkflowTUI (terminal). web → reducer +
// renderPanelHTML (any web host). All three consume the same PanelState.

// Shared (all tiers): the reducer (events → PanelState) + state shapes + formatters.
export { createPanelReducer } from "./ui/reducer.ts";
export type { PanelReducer } from "./ui/reducer.ts";
export type { PanelState, PhaseRow, AgentRow, PhaseStatus, AgentStatus } from "./ui/panel-state.ts";
export { formatTokens, formatDuration } from "./ui/format.ts";

// Terminal tier (pi-tui imported dynamically; safe without it).
export { renderWorkflowTUI } from "./ui/tui.ts";
export type { WorkflowTUI } from "./ui/tui.ts";
export { renderPanel } from "./ui/render-ansi.ts";

// Web tier: framework-agnostic HTML string + a stylesheet the host injects once.
export { renderPanelHTML, panelCSS } from "./ui/render-html.ts";

// Structured-output internals (handy for tests/examples that build fake models).
export { RESPOND_TOOL_NAME } from "./core/schema.ts";
export type { CompleteFn } from "./core/schema.ts";
