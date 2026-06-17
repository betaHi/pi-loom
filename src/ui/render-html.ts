/**
 * Framework-agnostic HTML rendering for the workflow panel.
 *
 * `renderPanelHTML(state)` returns an HTML fragment STRING — no DOM, no React,
 * no template library — visually isomorphic to the terminal `renderPanel`:
 * a header plus a single tree, every phase listed with its own sub-agents nested
 * beneath it. A web host injects `panelCSS` once into a <style>, then sets
 * `someNode.innerHTML = renderPanelHTML(state)` on each frame.
 *
 * SECURITY: name / description / phase titles / agent labels / model names are
 * all model-authored text, so EVERY dynamic value is HTML-escaped before it
 * reaches the markup. The numeric helpers emit digit strings but pass through
 * the escaper uniformly so nothing slips by.
 */

import type { PanelState, PhaseRow, AgentRow } from "./panel-state.ts";
import { formatTokens, formatDuration } from "./format.ts";

/** Escape the five HTML-significant characters. Applied to ALL dynamic text. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

// ── tree nodes ───────────────────────────────────────────────────────────────
/** One phase node: header line + its agents nested beneath (the full tree). */
function phaseNodeHTML(p: PhaseRow, i: number): string {
  // Marks mirror render-ansi: done ✓, active ❯, pending the 1-based index.
  const mark = p.status === "done" ? "✓" : p.status === "active" ? "❯" : `${i + 1}`;
  const count = p.total > 0 ? `<span class="pl-phase-count">${p.done}/${p.total}</span>` : "";
  const agents = p.agents.map((a) => agentRowHTML(a)).join("");
  return (
    `<div class="pl-phase-node pl-phase--${p.status}">` +
    `<div class="pl-phase">` +
    `<span class="pl-mark">${esc(mark)}</span>` +
    `<span class="pl-phase-title">${esc(p.title)}</span>` +
    count +
    `</div>` +
    (agents ? `<div class="pl-phase-agents">${agents}</div>` : "") +
    `</div>`
  );
}

// ── agent row (nested under its phase) ───────────────────────────────────────
function agentMeta(a: AgentRow): string {
  // Same omit rules as render-ansi's agentLine.
  const parts: string[] = [];
  if (a.tokens > 0) parts.push(`${formatTokens(a.tokens)} tok`);
  if (a.tools) parts.push(`${a.tools} tools`);
  if (a.elapsedMs && a.status !== "running") parts.push(formatDuration(a.elapsedMs));
  return parts.join(" · ");
}

/** Clamp a label so a model that passes a whole sentence as its agent label
 *  can't blow out the row (and shove the model badge / meta off-screen). CSS
 *  ellipsis handles the visual cut; this caps the raw string too. */
function clampLabel(s: string): string {
  return s.length > 48 ? s.slice(0, 47) + "…" : s;
}

function agentRowHTML(a: AgentRow): string {
  const mark = a.status === "done" ? "✓" : a.status === "failed" ? "✗" : "●";
  const badge = a.model ? `<span class="pl-badge">${esc(a.model)}</span>` : "";
  const meta = agentMeta(a);
  const metaHTML = meta ? `<span class="pl-agent-meta">${esc(meta)}</span>` : "";
  return (
    `<div class="pl-agent pl-agent--${a.status}">` +
    `<span class="pl-mark">${esc(mark)}</span>` +
    `<span class="pl-agent-label" title="${esc(a.label)}">${esc(clampLabel(a.label))}</span>` +
    badge +
    metaHTML +
    `</div>`
  );
}

// ── full panel ───────────────────────────────────────────────────────────────
export function renderPanelHTML(state: PanelState): string {
  const progress = `${state.agentsDone}/${state.agentsTotal} agents · ${formatDuration(state.elapsedMs)}`;
  const desc = state.description ? `<span class="pl-desc">${esc(state.description)}</span>` : "";

  // One tree: every phase node carries its own agents (indented beneath it).
  const tree = state.phases.map((p, i) => phaseNodeHTML(p, i)).join("");

  return (
    `<div class="pl-panel">` +
    `<div class="pl-header">` +
    `<div class="pl-title">${esc(state.name)}</div>` +
    `<div class="pl-sub">${desc}<span class="pl-stat">${esc(progress)}</span></div>` +
    `</div>` +
    `<div class="pl-tree">${tree}</div>` +
    `</div>`
  );
}

/**
 * Default stylesheet, injected ONCE by the host (e.g. into a <style> element).
 * Scoped under `.pl-*` to avoid collisions; a host may override any rule to
 * theme the panel. Mirrors the terminal aesthetic: monospace, dim chrome,
 * green ✓ / blue ❯ / red ✗.
 */
export const panelCSS = `
.pl-panel{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;color:#d4d4d4;background:#1e1e1e;border:1px solid #333;border-radius:6px;padding:10px 12px;max-width:100%;box-sizing:border-box}
.pl-header{margin-bottom:8px}
.pl-title{font-weight:700;color:#4ea1ff}
.pl-sub{display:flex;justify-content:space-between;gap:12px;color:#888;font-size:11px}
.pl-desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-stat{flex:none;white-space:nowrap}
.pl-tree{display:flex;flex-direction:column}
.pl-phase-node{margin-bottom:2px}
.pl-phase{display:flex;align-items:baseline;gap:6px;padding:1px 0;white-space:nowrap;overflow:hidden}
.pl-phase-agents{margin-left:10px;padding-left:10px;border-left:1px solid #333}
.pl-agent{display:flex;align-items:baseline;gap:6px;padding:1px 0;white-space:nowrap;overflow:hidden}
.pl-mark{flex:none;width:1.2em;text-align:center}
.pl-phase-title{overflow:hidden;text-overflow:ellipsis}
.pl-agent-label{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.pl-phase-count{flex:none;color:#888;margin-left:6px}
.pl-phase--done .pl-phase>.pl-mark{color:#3fb950}
.pl-phase--done .pl-phase-title{font-weight:700}
.pl-phase--active .pl-phase>.pl-mark{color:#4ea1ff}
.pl-phase--active .pl-phase-title{color:#4ea1ff;font-weight:700}
.pl-phase--pending .pl-phase{color:#888}
.pl-badge{flex:none;color:#888;font-size:11px}
.pl-agent-meta{flex:none;color:#888;margin-left:auto;padding-left:8px;white-space:nowrap}
.pl-agent--done>.pl-mark{color:#3fb950}
.pl-agent--failed>.pl-mark{color:#f85149}
.pl-agent--running>.pl-mark{color:#888}
.pl-agent--done .pl-agent-label,.pl-agent--failed .pl-agent-label{font-weight:700}
`.trim();
