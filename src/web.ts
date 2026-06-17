/**
 * pi-loom/web — the browser-safe entry point.
 *
 * The main entry (`pi-loom`) re-exports the whole engine, which pulls in Node-only
 * code (`node:vm`, acorn, the pi harness) — fine on a server, fatal in a browser
 * bundle. A web host needs ONLY the pure progress UI: fold the workflow event
 * stream into PanelState with the reducer, then render it with renderPanelHTML.
 *
 * Everything exported here is dependency-free and runs in any browser. Import it
 * in client code (`import { renderPanelHTML, panelCSS } from "pi-loom/web"`);
 * keep `pi-loom` itself for the server side that actually runs workflows.
 */

export { createPanelReducer } from "./ui/reducer.ts";
export type { PanelReducer } from "./ui/reducer.ts";
export type { PanelState, PhaseRow, AgentRow, PhaseStatus, AgentStatus } from "./ui/panel-state.ts";
export { formatTokens, formatDuration } from "./ui/format.ts";
export { renderPanelHTML, panelCSS } from "./ui/render-html.ts";
