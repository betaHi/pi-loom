import { describe, it, expect } from "vitest";
import { AgentPool } from "./pool.ts";
import { makeParallel } from "./parallel.ts";
import { makePipeline } from "./pipeline.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("AgentPool", () => {
  it("never exceeds the concurrency limit", async () => {
    const pool = new AgentPool(3, 1000);
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () =>
      pool.run(async () => {
        peak = Math.max(peak, pool.activeCount);
        await sleep(10);
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(3);
    expect(pool.startedCount).toBe(20);
  });

  it("throws once maxTotal agents have started", async () => {
    const pool = new AgentPool(2, 3);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => pool.run(async () => sleep(5))),
    );
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBe(2); // 3 allowed, 2 over the cap
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/cap reached/);
  });
});

describe("parallel (barrier)", () => {
  it("awaits all thunks and returns results in order", async () => {
    const parallel = makeParallel();
    const out = await parallel([
      async () => {
        await sleep(20);
        return "a";
      },
      async () => "b",
      async () => {
        await sleep(5);
        return "c";
      },
    ]);
    expect(out).toEqual(["a", "b", "c"]); // order preserved despite timing
  });

  it("maps a throwing thunk to null instead of rejecting", async () => {
    const parallel = makeParallel();
    const out = await parallel([
      async () => "ok",
      async () => {
        throw new Error("boom");
      },
    ]);
    expect(out).toEqual(["ok", null]);
  });
});

describe("pipeline (no barrier)", () => {
  it("lets a fast item reach the last stage before a slow item leaves stage 1", async () => {
    const pipeline = makePipeline();
    const events: string[] = [];

    // Item "fast" has tiny stage-1 latency; item "slow" has large stage-1 latency.
    // With NO barrier, fast should complete stage 2 before slow finishes stage 1.
    const items = [
      { id: "slow", s1: 60 },
      { id: "fast", s1: 1 },
    ];

    await pipeline(
      items,
      async (item: { id: string; s1: number }) => {
        await sleep(item.s1);
        events.push(`${item.id}:stage1-done`);
        return item.id;
      },
      async (id: string) => {
        events.push(`${id}:stage2-done`);
        return id;
      },
    );

    // Proof of no barrier: fast finished BOTH stages before slow finished stage 1.
    const fastStage2 = events.indexOf("fast:stage2-done");
    const slowStage1 = events.indexOf("slow:stage1-done");
    expect(fastStage2).toBeLessThan(slowStage1);
  });

  it("passes (prevResult, originalItem, index) to each stage", async () => {
    const pipeline = makePipeline();
    const seen: Array<[unknown, unknown, number]> = [];
    const out = await pipeline(
      ["x", "y"],
      (prev, item, i) => {
        seen.push([prev, item, i]);
        return `${prev}1`;
      },
      (prev, item, i) => {
        seen.push([prev, item, i]);
        return `${prev}2`;
      },
    );
    expect(out).toEqual(["x12", "y12"]);
    // stage 1 sees prev===item; stage 2 sees prev==="x1" but originalItem==="x"
    expect(seen).toContainEqual(["x", "x", 0]);
    expect(seen).toContainEqual(["x1", "x", 0]);
  });

  it("drops an item to null when a stage throws, skipping later stages", async () => {
    const pipeline = makePipeline();
    let stage2Calls = 0;
    const out = await pipeline(
      ["good", "bad"],
      (item: string) => {
        if (item === "bad") throw new Error("stage1 fail");
        return item;
      },
      (item: string) => {
        stage2Calls++;
        return item.toUpperCase();
      },
    );
    expect(out).toEqual(["GOOD", null]);
    expect(stage2Calls).toBe(1); // "bad" never reached stage 2
  });
});
