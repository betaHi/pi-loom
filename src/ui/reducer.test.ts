import { describe, it, expect } from "vitest";
import { createPanelReducer } from "./reducer.ts";
import type { WorkflowEvent } from "../types.ts";

/** A controllable fake clock so elapsed math is deterministic. */
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createPanelReducer", () => {
  it("seeds declared phases and tracks the active phase", () => {
    const clock = fakeClock();
    const r = createPanelReducer(
      { name: "demo", phases: [{ title: "Scope" }, { title: "Search" }] },
      clock.now,
    );
    // Declared phases present before any event, none active yet.
    expect(r.getState().phases.map((p) => p.title)).toEqual(["Scope", "Search"]);
    expect(r.getState().activePhase).toBe("");

    r.onEvent({ type: "phase", title: "Scope" });
    expect(r.getState().activePhase).toBe("Scope");
    expect(r.getState().phases[0]!.status).toBe("active");

    r.onEvent({ type: "phase", title: "Search" });
    const s = r.getState();
    expect(s.activePhase).toBe("Search");
    expect(s.phases[0]!.status).toBe("done"); // index < activeIdx
    expect(s.phases[1]!.status).toBe("active");
  });

  it("appends an undeclared phase exactly once", () => {
    const r = createPanelReducer({ name: "demo" }, fakeClock().now);
    r.onEvent({ type: "phase", title: "Extra" });
    r.onEvent({ type: "phase", title: "Extra" });
    expect(r.getState().phases.filter((p) => p.title === "Extra")).toHaveLength(1);
  });

  it("transitions an agent from running to done with tokens/tools/elapsed", () => {
    const clock = fakeClock();
    const r = createPanelReducer({ name: "demo" }, clock.now);
    r.onEvent({ type: "phase", title: "Search" });

    const start: WorkflowEvent = {
      type: "agent_start",
      label: "search:a",
      phase: "Search",
      callIndex: 0,
      model: "Opus",
    };
    r.onEvent(start);
    const activeAgents = () => r.getState().phases.find((p) => p.status === "active")?.agents ?? [];
    let a = activeAgents()[0]!;
    expect(a.status).toBe("running");
    expect(a.tokens).toBe(0);
    expect(a.elapsedMs).toBeUndefined(); // running → no snapshot

    clock.advance(5000);
    r.onEvent({
      type: "agent_end",
      label: "search:a",
      phase: "Search",
      callIndex: 0,
      outputTokens: 1200,
      tools: 3,
      cached: false,
      ok: true,
    });
    a = activeAgents()[0]!;
    expect(a.status).toBe("done");
    expect(a.tokens).toBe(1200);
    expect(a.tools).toBe(3);
    expect(a.elapsedMs).toBe(5000); // frozen at agent_end
  });

  it("marks a failed agent and counts done/total", () => {
    const r = createPanelReducer({ name: "demo" }, fakeClock().now);
    r.onEvent({ type: "phase", title: "P" });
    r.onEvent({ type: "agent_start", label: "x", phase: "P", callIndex: 0 });
    r.onEvent({ type: "agent_start", label: "y", phase: "P", callIndex: 1 });
    r.onEvent({
      type: "agent_end",
      label: "x",
      phase: "P",
      callIndex: 0,
      outputTokens: 10,
      cached: false,
      ok: false,
    });
    const s = r.getState();
    expect(s.phases[0]!.agents.find((a) => a.label === "x")!.status).toBe("failed");
    expect(s.agentsDone).toBe(1); // x finished (failed counts as not-running)
    expect(s.agentsTotal).toBe(2);
    expect(s.phases[0]!.done).toBe(1);
    expect(s.phases[0]!.total).toBe(2);
  });

  it("nests each phase's agents under that phase (full tree)", () => {
    const r = createPanelReducer({ name: "demo" }, fakeClock().now);
    r.onEvent({ type: "phase", title: "A" });
    r.onEvent({ type: "agent_start", label: "a1", phase: "A", callIndex: 0 });
    r.onEvent({ type: "phase", title: "B" });
    r.onEvent({ type: "agent_start", label: "b1", phase: "B", callIndex: 1 });
    const s = r.getState();
    // Both phases keep their own agents — the whole plan is visible at once.
    expect(s.phases.find((p) => p.title === "A")!.agents.map((a) => a.label)).toEqual(["a1"]);
    expect(s.phases.find((p) => p.title === "B")!.agents.map((a) => a.label)).toEqual(["b1"]);
  });

  it("computes run elapsedMs live from the injected clock", () => {
    const clock = fakeClock(1000);
    const r = createPanelReducer({ name: "demo" }, clock.now);
    expect(r.getState().elapsedMs).toBe(0);
    clock.advance(2500);
    expect(r.getState().elapsedMs).toBe(2500); // recomputed each getState
  });
});
