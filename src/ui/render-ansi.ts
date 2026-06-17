/**
 * Pure ANSI rendering for the workflow panel — no terminal, no state, no side
 * effects. Everything here is a pure function from data → lines of text (with
 * ANSI color). That makes the layout unit-testable and printable for README
 * snapshots, and keeps the stateful controller (tui.ts) thin.
 *
 * Layout mirrors Claude's /workflows view: a header line, then a single tree —
 * every phase listed in order, each with its own sub-agents nested beneath it
 * (model badge / tokens / tools / elapsed), current phase highlighted.
 *
 * Shared shapes (PanelState etc.) live in panel-state.ts; shared number
 * formatting (formatTokens/formatDuration) lives in format.ts. The ANSI-only
 * helpers (color, visibleWidth, truncate) stay here — the HTML renderer uses CSS
 * for the same jobs.
 */

import type { PanelState, AgentRow } from "./panel-state.ts";
import { formatTokens, formatDuration } from "./format.ts";

// ── ANSI ───────────────────────────────────────────────────────────────────
const ESC = "\x1b[";
const c = (code: string, s: string): string => `${ESC}${code}m${s}${ESC}0m`;
const color = {
  bold: (s: string) => c("1", s),
  dim: (s: string) => c("90", s),
  blue: (s: string) => c("34", s),
  boldBlue: (s: string) => c("1;34", s),
  green: (s: string) => c("32", s),
  red: (s: string) => c("31", s),
};

/** Visible width, ignoring ANSI escape sequences. */
export function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padEnd(s: string, width: number): string {
  const pad = width - visibleWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

/** Truncate to a visible width, preserving ANSI and resetting at the cut. */
function truncate(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;
  let out = "";
  let w = 0;
  // eslint-disable-next-line no-control-regex
  const parts = s.split(/(\x1b\[[0-9;]*m)/);
  for (const part of parts) {
    if (part.startsWith("\x1b[")) {
      out += part;
      continue;
    }
    for (const ch of part) {
      if (w >= width - 1) return `${out}…\x1b[0m`;
      out += ch;
      w++;
    }
  }
  return out;
}

// ── tree rows ────────────────────────────────────────────────────────────────
/** One phase header line: mark + number + title + done/total count. */
function phaseLine(p: PanelState["phases"][number], i: number): string {
  const n = `${i + 1}`;
  const count = p.total > 0 ? ` ${p.done}/${p.total}` : "";
  if (p.status === "done") {
    return `${color.green("✓")} ${color.bold(p.title)}${color.dim(count)}`;
  }
  if (p.status === "active") {
    return `${color.blue("❯")} ${color.boldBlue(p.title)}${color.blue(count)}`;
  }
  return color.dim(`${n}. ${p.title}`);
}

/** One agent line, indented under its phase. */
function agentLine(a: AgentRow): string {
  const mark =
    a.status === "done" ? color.green("✓") : a.status === "failed" ? color.red("✗") : color.dim("●");
  // Clamp the label so a model that passes a whole sentence as its label can't
  // push the trailing meta (which holds the model name) off the line.
  const raw = a.label.length > 40 ? a.label.slice(0, 39) + "…" : a.label;
  const label = a.status === "running" ? raw : color.bold(raw);
  const meta: string[] = [];
  if (a.model) meta.push(a.model);
  if (a.tokens > 0) meta.push(`${formatTokens(a.tokens)} tok`);
  if (a.tools) meta.push(`${a.tools} tools`);
  if (a.elapsedMs && a.status !== "running") meta.push(formatDuration(a.elapsedMs));
  const metaStr = meta.length ? color.dim(` · ${meta.join(" · ")}`) : "";
  // Indent: 4 spaces + a tree connector under the phase.
  return `    ${color.dim("└")} ${mark} ${label}${metaStr}`;
}

// ── full panel ───────────────────────────────────────────────────────────────
export function renderPanel(state: PanelState, totalWidth = 120): string[] {
  // Clamp to the real terminal width; a TUI library may reject any line wider than this.
  const width = Math.max(40, totalWidth);

  // Header
  const progress = color.dim(
    `${state.agentsDone}/${state.agentsTotal} agents · ${formatDuration(state.elapsedMs)}`,
  );
  const titleLine = color.boldBlue(state.name);
  const subLeft = state.description ? color.dim(state.description) : "";
  const subLine = truncate(padEnd(subLeft, width - visibleWidth(progress)) + progress, width);

  // One tree: every phase, each followed by its own agents (indented).
  const rows: string[] = [];
  state.phases.forEach((p, i) => {
    rows.push(truncate(phaseLine(p, i), width));
    for (const a of p.agents) rows.push(truncate(agentLine(a), width));
  });

  return [truncate(titleLine, width), subLine, "", ...rows];
}
