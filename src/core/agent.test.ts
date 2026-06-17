import { describe, it, expect, vi } from "vitest";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { runAgent, type AgentRunDeps } from "./agent.ts";
import { RESPOND_TOOL_NAME, type CompleteFn } from "./schema.ts";

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
    content: [{ type: "toolCall", id: "t1", name: RESPOND_TOOL_NAME, arguments: args }],
    api: "anthropic-messages",
    provider: "anthropic" as never,
    model: "fake",
    usage: { ...EMPTY_USAGE, output, totalTokens: output },
    stopReason: "toolUse" as never,
    timestamp: Date.now(),
  };
}

function baseDeps(completeFn: CompleteFn, extra?: Partial<AgentRunDeps>): AgentRunDeps {
  return { defaultModel: fakeModel, systemPrompt: "sys", completeFn, ...extra };
}

describe("runAgent", () => {
  it("returns assistant text when no schema is given", async () => {
    const fake: CompleteFn = async () => textMsg("hello world");
    const out = await runAgent("hi", undefined, baseDeps(fake));
    expect(out).toBe("hello world");
  });

  it("returns a validated object when a schema is given", async () => {
    const schema = Type.Object({ ok: Type.Boolean() });
    const fake: CompleteFn = async () => respondMsg({ ok: true });
    const out = await runAgent("check", { schema }, baseDeps(fake));
    expect(out).toEqual({ ok: true });
  });

  it("reports output tokens via onUsage", async () => {
    const onUsage = vi.fn();
    const fake: CompleteFn = async () => textMsg("x", 123);
    await runAgent("hi", undefined, baseDeps(fake, { onUsage }));
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage.mock.calls[0]![0].output).toBe(123);
  });

  it("retries on failure then succeeds", async () => {
    let calls = 0;
    const fake: CompleteFn = async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return textMsg("recovered");
    };
    const out = await runAgent("hi", { retries: 2 }, baseDeps(fake));
    expect(out).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("returns null after exhausting retries", async () => {
    let calls = 0;
    const fake: CompleteFn = async () => {
      calls++;
      throw new Error("always fails");
    };
    const out = await runAgent("hi", { retries: 2 }, baseDeps(fake));
    expect(out).toBeNull();
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("does not call onUsage when all attempts fail", async () => {
    const onUsage = vi.fn();
    const fake: CompleteFn = async () => {
      throw new Error("nope");
    };
    await runAgent("hi", { retries: 0 }, baseDeps(fake, { onUsage }));
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("throws if budget is exhausted before running", async () => {
    const fake: CompleteFn = async () => textMsg("x");
    const checkBudget = () => {
      throw new Error("budget exhausted");
    };
    await expect(runAgent("hi", undefined, baseDeps(fake, { checkBudget }))).rejects.toThrow(
      /budget exhausted/,
    );
  });

  it("resolves system prompt from agentType registry", async () => {
    let seenSystem: string | undefined;
    const fake: CompleteFn = async (_m, ctx) => {
      seenSystem = ctx.systemPrompt;
      return textMsg("ok");
    };
    await runAgent("hi", { agentType: "skeptic" }, baseDeps(fake, {
      agentTypes: { skeptic: "You are skeptical." },
    }));
    expect(seenSystem).toBe("You are skeptical.");
  });

  it("throws a clear error when no model is available", async () => {
    const fake: CompleteFn = async () => textMsg("x");
    await expect(
      runAgent("hi", undefined, { systemPrompt: "sys", completeFn: fake }),
    ).rejects.toThrow(/needs a model/);
  });
});
