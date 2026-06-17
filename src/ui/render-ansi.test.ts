import { describe, it, expect } from "vitest";
import { renderPanel, visibleWidth } from "./render-ansi.ts";
import { formatTokens, formatDuration } from "./format.ts";
import type { PanelState } from "./panel-state.ts";

describe("formatTokens", () => {
  it("formats small and large counts", () => {
    expect(formatTokens(376)).toBe("376");
    expect(formatTokens(48700)).toBe("48.7k");
    expect(formatTokens(120000)).toBe("120k");
  });
});

describe("formatDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatDuration(28000)).toBe("28s");
    expect(formatDuration(330000)).toBe("5m30s");
  });
});

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

describe("renderPanel", () => {
  it("renders a header, all phase titles, and agent rows in one tree", () => {
    const out = renderPanel(sample, 130).join("\n");
    expect(out).toContain("demo-run");
    expect(out).toContain("2/4 agents · 1m30s");
    // Every phase is listed up front (the full plan), not just the active one.
    expect(out).toContain("Scope");
    expect(out).toContain("Research");
    expect(out).toContain("Verify");
    // Agents are nested under their phase.
    expect(out).toContain("research:a");
    expect(out).toContain("1.2k tok · 3 tools · 12s");
  });

  it("nests agents from multiple phases (whole tree visible, not only active)", () => {
    const out = renderPanel(sample, 130).join("\n");
    // scope:a belongs to the done phase, research:a to the active one — both show.
    expect(out).toContain("scope:a");
    expect(out).toContain("research:a");
  });

  it("never emits a line wider than the given width (pi-tui safety)", () => {
    for (const w of [60, 80, 100, 130]) {
      for (const line of renderPanel(sample, w)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(w);
      }
    }
  });

  it("visibleWidth ignores ANSI codes", () => {
    expect(visibleWidth("\x1b[1mhi\x1b[0m")).toBe(2);
  });
});
