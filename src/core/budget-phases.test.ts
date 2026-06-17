import { describe, it, expect, vi } from "vitest";
import { BudgetTracker } from "./budget.ts";
import { PhaseTracker } from "./phases.ts";
import type { WorkflowEvent } from "../types.ts";

describe("BudgetTracker", () => {
  it("reports Infinity remaining when unbounded", () => {
    const b = new BudgetTracker(null);
    expect(b.total).toBeNull();
    expect(b.remaining()).toBe(Number.POSITIVE_INFINITY);
    b.check(); // never throws when unbounded
  });

  it("accumulates output tokens and computes remaining", () => {
    const b = new BudgetTracker(100);
    b.add(30);
    b.add(20);
    expect(b.spent()).toBe(50);
    expect(b.remaining()).toBe(50);
  });

  it("check() throws once spent reaches total", () => {
    const b = new BudgetTracker(50);
    b.add(50);
    expect(() => b.check()).toThrow(/budget exhausted/);
  });

  it("check() passes while under budget", () => {
    const b = new BudgetTracker(50);
    b.add(49);
    expect(() => b.check()).not.toThrow();
    expect(b.remaining()).toBe(1);
  });

  it("view() exposes a read-only handle", () => {
    const b = new BudgetTracker(100);
    b.add(10);
    const v = b.view();
    expect(v.total).toBe(100);
    expect(v.spent()).toBe(10);
    expect(v.remaining()).toBe(90);
    expect("add" in v).toBe(false);
    expect("check" in v).toBe(false);
  });
});

describe("PhaseTracker", () => {
  it("tracks the current phase and emits a phase event", () => {
    const events: WorkflowEvent[] = [];
    const p = new PhaseTracker((e) => events.push(e));
    p.phase("Search");
    expect(p.currentPhase).toBe("Search");
    expect(events).toContainEqual({ type: "phase", title: "Search" });
  });

  it("emits log events", () => {
    const emit = vi.fn();
    const p = new PhaseTracker(emit);
    p.log("hello");
    expect(emit).toHaveBeenCalledWith({ type: "log", message: "hello" });
  });
});
