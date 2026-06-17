import { describe, it, expect, vi } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { runWorkflow } from "./runWorkflow.ts";
import { RESPOND_TOOL_NAME, type CompleteFn } from "../core/schema.ts";
import type { WorkflowEvent } from "../types.ts";

const fakeModel = { api: "anthropic-messages" } as unknown as Model<any>;

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function textMsg(text: string, output = 5): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic" as never,
    model: "fake",
    usage: { ...EMPTY_USAGE, output, totalTokens: output },
    stopReason: "stop" as never,
    timestamp: Date.now(),
  };
}

function respondMsg(args: Record<string, unknown>, output = 7): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "t", name: RESPOND_TOOL_NAME, arguments: args }],
    api: "anthropic-messages",
    provider: "anthropic" as never,
    model: "fake",
    usage: { ...EMPTY_USAGE, output, totalTokens: output },
    stopReason: "toolUse" as never,
    timestamp: Date.now(),
  };
}

describe("runWorkflow", () => {
  it("injects primitives and returns the script result", async () => {
    const fake: CompleteFn = async () => textMsg("the answer");
    const { result } = await runWorkflow(
      async ({ agent }) => {
        return await agent("question?");
      },
      { model: fakeModel, completeFn: fake },
    );
    expect(result).toBe("the answer");
  });

  it("runs a parallel fan-out and aggregates stats", async () => {
    const fake: CompleteFn = async () => textMsg("x", 10);
    const { result, stats } = await runWorkflow(
      async ({ parallel, agent }) => {
        return await parallel([
          () => agent("a"),
          () => agent("b"),
          () => agent("c"),
        ]);
      },
      { model: fakeModel, completeFn: fake },
    );
    expect(result).toEqual(["x", "x", "x"]);
    expect(stats.agentCalls).toBe(3);
    expect(stats.outputTokens).toBe(30);
  });

  it("supports a schema → structured-output agent", async () => {
    const schema = Type.Object({ verdict: Type.Boolean() });
    const fake: CompleteFn = async () => respondMsg({ verdict: true });
    const { result } = await runWorkflow(
      async ({ agent }) => agent("judge", { schema }),
      { model: fakeModel, completeFn: fake },
    );
    expect(result).toEqual({ verdict: true });
  });

  it("emits phase/agent/budget events in order", async () => {
    const events: WorkflowEvent[] = [];
    const fake: CompleteFn = async () => textMsg("x", 3);
    await runWorkflow(
      async ({ phase, agent, log }) => {
        phase("Find");
        log("starting");
        await agent("find bugs");
      },
      { model: fakeModel, completeFn: fake, onEvent: (e) => events.push(e) },
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "phase",
      "log",
      "agent_start",
      "agent_end",
      "budget",
    ]);
    const start = events.find((e) => e.type === "agent_start");
    expect(start && "phase" in start && start.phase).toBe("Find");
  });

  it("enforces the token budget (agent throws, parallel maps to null)", async () => {
    const fake: CompleteFn = async () => textMsg("x", 40);
    const { result, stats } = await runWorkflow(
      async ({ parallel, agent }) => {
        // budget 50: first agent spends 40, second sees spent<50 so runs (spends
        // 40 → 80), third sees spent>=50 → check() throws → null.
        return await parallel([() => agent("a"), () => agent("b"), () => agent("c")]);
      },
      { model: fakeModel, completeFn: fake, budget: 50, concurrency: 1 },
    );
    // With concurrency 1, calls run in order: a ok, b ok, c refused → null
    expect(result[0]).toBe("x");
    expect(result).toContain(null);
    expect(stats.outputTokens).toBeLessThanOrEqual(80);
  });

  it("resumes from a journal: second run hits cache, no model calls", async () => {
    const tmpPath = join(tmpdir(), `dpw-wf-resume-${process.pid}.json`);
    if (existsSync(tmpPath)) rmSync(tmpPath);

    const calls = vi.fn();
    const fake: CompleteFn = async () => {
      calls();
      return textMsg("computed", 9);
    };
    const script = async ({ agent, parallel }: any) =>
      parallel([() => agent("a"), () => agent("b")]);

    const run1 = await runWorkflow(script, {
      model: fakeModel,
      completeFn: fake,
      journalPath: tmpPath,
    });
    expect(run1.result).toEqual(["computed", "computed"]);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(run1.stats.cachedCalls).toBe(0);

    // Second run: same script + args → all cached, zero model calls.
    const run2 = await runWorkflow(script, {
      model: fakeModel,
      completeFn: fake,
      journalPath: tmpPath,
    });
    expect(run2.result).toEqual(["computed", "computed"]);
    expect(calls).toHaveBeenCalledTimes(2); // unchanged — no new model calls
    expect(run2.stats.cachedCalls).toBe(2);

    rmSync(tmpPath);
  });

  it("passes args through to the script", async () => {
    const fake: CompleteFn = async () => textMsg("x");
    const { result } = await runWorkflow(
      async ({ args }) => args,
      { model: fakeModel, completeFn: fake, args: { topic: "pi" } },
    );
    expect(result).toEqual({ topic: "pi" });
  });
});
