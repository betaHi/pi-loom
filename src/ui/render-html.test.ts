import { describe, it, expect } from "vitest";
import { renderPanelHTML, panelCSS } from "./render-html.ts";
import type { PanelState } from "./panel-state.ts";

const sample: PanelState = {
  name: "demo-run",
  description: "a demo",
  agentsDone: 2,
  agentsTotal: 4,
  elapsedMs: 90000,
  activePhase: "Research",
  phases: [
    { title: "Scope", status: "done", done: 1, total: 1, agents: [
      { label: "scope:a", status: "done", model: "Opus 4.8", tokens: 800, elapsedMs: 9000 },
    ] },
    { title: "Research", status: "active", done: 1, total: 3, agents: [
      { label: "research:a", status: "done", model: "Opus 4.8", tokens: 1200, tools: 3, elapsedMs: 12000 },
      { label: "research:b", status: "running", model: "Opus 4.8", tokens: 0 },
    ] },
    { title: "Verify", status: "pending", done: 0, total: 0, agents: [] },
  ],
};

describe("renderPanelHTML", () => {
  it("renders the panel scaffold, header, and the full phase tree", () => {
    const html = renderPanelHTML(sample);
    expect(html).toContain('class="pl-panel"');
    expect(html).toContain("demo-run");
    expect(html).toContain("a demo");
    expect(html).toContain("2/4 agents · 1m30s");
    expect(html).toContain('class="pl-tree"');
    // All phases listed up front.
    expect(html).toContain("Scope");
    expect(html).toContain("Research");
    expect(html).toContain("Verify");
  });

  it("marks phases by status with the same glyphs as the TUI", () => {
    const html = renderPanelHTML(sample);
    expect(html).toContain("pl-phase--done");
    expect(html).toContain("pl-phase--active");
    expect(html).toContain("pl-phase--pending");
    expect(html).toContain("❯"); // active phase mark
  });

  it("nests each phase's agents beneath it (full tree, not only active)", () => {
    const html = renderPanelHTML(sample);
    expect(html).toContain('class="pl-phase-agents"');
    // Both a done-phase agent and an active-phase agent appear.
    expect(html).toContain("scope:a");
    expect(html).toContain("research:a");
    expect(html).toContain("1.2k tok · 3 tools · 12s");
    expect(html).toContain("pl-agent--done");
    expect(html).toContain("pl-agent--running");
    expect(html).toContain("●"); // running mark
  });

  it("omits the model badge when model is undefined", () => {
    const state: PanelState = {
      ...sample,
      phases: [{ title: "P", status: "active", done: 0, total: 1, agents: [
        { label: "no-model", status: "running", tokens: 0 },
      ] }],
    };
    const html = renderPanelHTML(state);
    expect(html).toContain("no-model");
    expect(html).not.toContain("pl-badge");
  });

  it("omits meta entirely for a fresh running agent (no tokens/tools/elapsed)", () => {
    const state: PanelState = {
      ...sample,
      phases: [{ title: "P", status: "active", done: 0, total: 1, agents: [
        { label: "fresh", status: "running", tokens: 0 },
      ] }],
    };
    expect(renderPanelHTML(state)).not.toContain("pl-agent-meta");
  });

  it("HTML-escapes model-authored text (XSS-safe)", () => {
    const evil: PanelState = {
      name: "<script>alert(1)</script>",
      description: "\"&'<>",
      agentsDone: 0,
      agentsTotal: 1,
      elapsedMs: 0,
      activePhase: "<img src=x onerror=alert(1)>",
      phases: [{ title: "<b>p</b>", status: "active", done: 0, total: 1, agents: [
        { label: "<img src=x onerror=alert(1)>", status: "running", tokens: 0 },
      ] }],
    };
    const html = renderPanelHTML(evil);
    // No raw injection survives.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>p</b>");
    // Escaped forms present.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&#39;");
  });

  it("clamps an over-long label so the model badge stays visible", () => {
    const longLabel = "inspect:" + "x".repeat(200); // a model passed a sentence as label
    const state: PanelState = {
      ...sample,
      phases: [{ title: "P", status: "active", done: 0, total: 1, agents: [
        { label: longLabel, status: "running", model: "claude-opus-4.8", tokens: 0 },
      ] }],
    };
    const html = renderPanelHTML(state);
    // The VISIBLE label text (between the tags) is truncated with an ellipsis…
    const visible = html.match(/<span class="pl-agent-label"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
    expect(visible).toContain("…");
    expect(visible.length).toBeLessThan(60);
    // …while the full label is preserved in the title attribute for hover.
    expect(html).toContain(`title="${longLabel}"`);
    // The model badge survives (the whole point — it used to get pushed off).
    expect(html).toContain("claude-opus-4.8");
  });

  it("exports a non-empty stylesheet scoped to .pl-panel", () => {
    expect(typeof panelCSS).toBe("string");
    expect(panelCSS.length).toBeGreaterThan(0);
    expect(panelCSS).toContain(".pl-panel");
  });
});
