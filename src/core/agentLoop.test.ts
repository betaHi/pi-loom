import { describe, it, expect, afterEach } from "vitest";
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  fauxText,
  Type,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { runToolLoop } from "./agentLoop.ts";

const registrations: FauxProviderRegistration[] = [];
afterEach(() => {
  for (const r of registrations) r.unregister?.();
  registrations.length = 0;
});

/** A trivial echo tool the faux model will "call". */
function echoTool(calls: string[]): AgentTool<any> {
  return {
    name: "echo",
    label: "echo",
    description: "Echo back the text.",
    parameters: Type.Object({ text: Type.String() }),
    async execute(_id, params: { text: string }) {
      calls.push(params.text);
      return { content: [{ type: "text", text: `echoed:${params.text}` }], details: undefined };
    },
  };
}

describe("runToolLoop", () => {
  it("drives a multi-turn tool loop and returns the final text", async () => {
    const reg = registerFauxProvider();
    registrations.push(reg);
    // Turn 1: model calls the echo tool. Turn 2: model emits final text.
    reg.setResponses([
      fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Summary: the tool said hello.")]),
    ]);

    const toolCalls: string[] = [];
    const { value, usage } = await runToolLoop(
      reg.getModel(),
      "You are a worker.",
      "use the echo tool then summarize",
      [echoTool(toolCalls)],
    );

    expect(toolCalls).toEqual(["hello"]); // the tool actually ran
    expect(value).toBe("Summary: the tool said hello.");
    expect(usage.output).toBeGreaterThan(0); // usage summed across turns
  });
});
