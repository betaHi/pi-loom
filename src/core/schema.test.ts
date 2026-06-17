import { describe, it, expect } from "vitest";
import type { AssistantMessage, Model, Context } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { completeStructured, RESPOND_TOOL_NAME, type CompleteFn } from "./schema.ts";

// A minimal fake model — only `.api` is read (to shape tool_choice).
const fakeModel = { api: "anthropic-messages" } as unknown as Model<any>;

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Build a fake AssistantMessage that calls `respond` with given args. */
function respondWith(args: Record<string, unknown>, outputTokens = 10): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "t1", name: RESPOND_TOOL_NAME, arguments: args }],
    api: "anthropic-messages",
    provider: "anthropic" as never,
    model: "fake",
    usage: { ...EMPTY_USAGE, output: outputTokens, totalTokens: outputTokens },
    stopReason: "toolUse" as never,
    timestamp: Date.now(),
  };
}

/** Build a fake AssistantMessage that returns plain text (no tool call). */
function textOnly(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic" as never,
    model: "fake",
    usage: EMPTY_USAGE,
    stopReason: "stop" as never,
    timestamp: Date.now(),
  };
}

const Schema = Type.Object({
  result: Type.String(),
  score: Type.Number(),
});

describe("completeStructured", () => {
  it("returns the validated object and usage when the model calls respond", async () => {
    const fake: CompleteFn = async () => respondWith({ result: "ok", score: 0.9 }, 42);
    const { value, usage } = await completeStructured(
      fakeModel,
      "sys",
      "do it",
      Schema,
      undefined,
      fake,
    );
    expect(value).toEqual({ result: "ok", score: 0.9 });
    expect(usage.output).toBe(42);
  });

  it("forces the correct tool_choice shape per provider (anthropic)", async () => {
    let seenOptions: Record<string, unknown> | undefined;
    const fake: CompleteFn = async (_m, _ctx, opts) => {
      seenOptions = opts;
      return respondWith({ result: "ok", score: 1 });
    };
    await completeStructured(fakeModel, "sys", "p", Schema, undefined, fake);
    expect(seenOptions?.toolChoice).toEqual({ type: "tool", name: RESPOND_TOOL_NAME });
  });

  it("passes the schema as the respond tool's parameters", async () => {
    let seenCtx: Context | undefined;
    const fake: CompleteFn = async (_m, ctx) => {
      seenCtx = ctx;
      return respondWith({ result: "ok", score: 1 });
    };
    await completeStructured(fakeModel, "sys", "p", Schema, undefined, fake);
    expect(seenCtx?.tools?.[0]?.name).toBe(RESPOND_TOOL_NAME);
    expect(seenCtx?.tools?.[0]?.parameters).toBe(Schema);
    expect(seenCtx?.systemPrompt).toBe("sys");
  });

  it("throws when the model does not call respond (so agent.ts can retry)", async () => {
    const fake: CompleteFn = async () => textOnly("I refuse to use the tool");
    await expect(
      completeStructured(fakeModel, "sys", "p", Schema, undefined, fake),
    ).rejects.toThrow(/did not call/);
  });

  it("throws when tool args violate the schema", async () => {
    // score is a string, not a number → TypeBox validation should reject
    const fake: CompleteFn = async () => respondWith({ result: "ok", score: "high" });
    await expect(
      completeStructured(fakeModel, "sys", "p", Schema, undefined, fake),
    ).rejects.toThrow();
  });
});
