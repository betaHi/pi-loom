import { describe, it, expect } from "vitest";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { runWorkflowSource, compileWorkflowScript, extractPhases } from "./runWorkflowSource.ts";
import type { CompleteFn } from "../core/schema.ts";

const fakeModel = { api: "anthropic-messages" } as unknown as Model<any>;

const textMsg = (text: string, output = 5): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "anthropic-messages",
  provider: "anthropic" as never,
  model: "fake",
  usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop" as never,
  timestamp: Date.now(),
});

const echo: CompleteFn = async (_m, ctx) => {
  const prompt = typeof ctx.messages[0]?.content === "string" ? ctx.messages[0].content : "";
  return textMsg(`echo:${prompt}`);
};

describe("compileWorkflowScript", () => {
  it("compiles a bare body that uses primitives + explicit return", () => {
    const script = compileWorkflowScript<unknown, string>(`return await agent("hi");`);
    expect(typeof script).toBe("function");
  });

  it("throws a clear error on a syntax error", () => {
    expect(() => compileWorkflowScript("this is ((( not js")).toThrow(/failed to parse/);
  });

  it("rejects Date.now() / Math.random() / new Date() at parse time (determinism)", () => {
    expect(() => compileWorkflowScript("return Date.now();")).toThrow(/deterministic/);
    expect(() => compileWorkflowScript("return Math.random();")).toThrow(/deterministic/);
    expect(() => compileWorkflowScript("return new Date();")).toThrow(/deterministic/);
  });

  it("rejects require / dynamic import (foot-gun guard)", () => {
    expect(() => compileWorkflowScript("const fs = require('fs');")).toThrow(/require|import/);
    expect(() => compileWorkflowScript("return import('fs');")).toThrow(/require|import/);
  });
});

describe("extractPhases", () => {
  it("pulls literal phase titles in source order, deduped", () => {
    const source = `
      phase("Discover");
      const a = await agent("...");
      phase("Detail");
      const b = await parallel([]);
      phase("Discover"); // dup, ignored
      phase("Summarize");
    `;
    expect(extractPhases(source)).toEqual(["Discover", "Detail", "Summarize"]);
  });

  it("ignores dynamically-built titles (only literals are knowable up front)", () => {
    const source = `const n = "X"; phase("Static"); phase(\`Dyn-\${n}\`);`;
    expect(extractPhases(source)).toEqual(["Static"]);
  });

  it("returns [] for an unparseable script (display sugar, never throws)", () => {
    expect(extractPhases("phase('unterminated")).toEqual([]);
  });

  it("returns [] when there are no phase() calls", () => {
    expect(extractPhases("return await agent('just one');")).toEqual([]);
  });
});

describe("runWorkflowSource", () => {
  it("runs an LLM-style script string end-to-end", async () => {
    const source = `
      phase("Work");
      log("starting");
      return await agent("do the thing");
    `;
    const { result } = await runWorkflowSource(source, { model: fakeModel, completeFn: echo });
    expect(result).toBe("echo:do the thing");
  });

  it("exposes parallel/pipeline and args to the script", async () => {
    const source = `
      const outs = await parallel(args.items.map(x => () => agent(x)));
      return outs;
    `;
    const { result, stats } = await runWorkflowSource(source, {
      model: fakeModel,
      completeFn: echo,
      args: { items: ["a", "b"] },
    });
    expect(result).toEqual(["echo:a", "echo:b"]);
    expect(stats.agentCalls).toBe(2);
  });

  it("isolates host globals: process / require are not reachable in the vm scope", async () => {
    // The vm sandbox only exposes the injected primitives + safe builtins. Host
    // access like `process` is undefined, and `globalThis` resolves to the
    // sandbox itself (not the host global), so no real process leaks in.
    const source = `return typeof process + "," + (globalThis.process === undefined);`;
    const { result } = await runWorkflowSource(source, { model: fakeModel, completeFn: echo });
    expect(result).toBe("undefined,true");
  });
});
