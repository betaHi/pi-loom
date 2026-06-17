/**
 * Multi-turn agent loop — used ONLY when an agent is given tools (so a sub-agent
 * can read files, grep, etc. while working). Without tools, agent.ts stays on
 * the lighter single-shot `complete()` path.
 *
 * This wraps pi-agent-core's `Agent`, which runs the turn/tool loop itself. We
 * just drive it to completion and extract the final text + summed token usage
 * (pi reports usage per assistant message; there is no cumulative field).
 */

import { Agent, type AgentTool, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model, AssistantMessage } from "@earendil-works/pi-ai";

const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function isAssistant(m: AgentMessage): m is AssistantMessage {
  return (m as { role?: string }).role === "assistant";
}

/** Sum per-message usage across the whole transcript. */
function sumUsage(messages: AgentMessage[]): AssistantMessage["usage"] {
  const total = { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } };
  for (const m of messages) {
    if (!isAssistant(m) || !m.usage) continue;
    total.input += m.usage.input;
    total.output += m.usage.output;
    total.cacheRead += m.usage.cacheRead;
    total.cacheWrite += m.usage.cacheWrite;
    total.totalTokens += m.usage.totalTokens;
    total.cost.total += m.usage.cost.total;
  }
  return total;
}

/** Final assistant text in the transcript. */
function finalText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && isAssistant(m)) {
      return m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
    }
  }
  return "";
}

/**
 * Run a tool-using agent to completion. Returns the final text, the summed usage
 * across all turns, and how many tool calls were executed. Throws on abort
 * (caller handles retries / null).
 */
export async function runToolLoop(
  model: Model<any>,
  systemPrompt: string,
  prompt: string,
  tools: AgentTool<any>[],
  signal?: AbortSignal,
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined,
  maxRetryDelayMs?: number,
): Promise<{ value: string; usage: AssistantMessage["usage"]; toolCalls: number }> {
  // By default the Agent's stream resolves the provider key from the environment
  // (pi-ai's withEnvApiKey), so sub-agents authenticate like a host whose key is
  // in the env. When the host resolves credentials some other way (e.g. a pi
  // ModelRegistry keyed by a custom provider name), it passes `getApiKey` so the
  // sub-agent authenticates identically — without it, a custom-provider model
  // can't authenticate and the loop returns empty.
  //
  // `maxRetryDelayMs` caps how long the Agent honors a provider-requested retry
  // delay. Without it, a provider that rejects an over-large request (e.g. a 408
  // "request body too big") and asks to retry after a long wait can keep the
  // Agent retrying without ever reaching `agent_end`, stalling the whole workflow.
  // Capping the delay makes it give up and emit `agent_end` so the loop returns.
  const agent = new Agent({ initialState: { systemPrompt, model, tools }, getApiKey, maxRetryDelayMs });

  let toolCalls = 0;
  // Drive the Agent to completion. `agent_end` is its final event and normally
  // always fires. We also reject on the abort signal so a host that bounds run
  // time (or the user cancelling) can break the wait; the caller's retry/null
  // policy then takes over.
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    if (signal?.aborted) return reject(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    agent.subscribe((event) => {
      if (event.type === "tool_execution_end") toolCalls++;
      else if (event.type === "agent_end") {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }
    });
    void agent.prompt(prompt);
  });

  if (signal?.aborted) throw new Error("aborted");
  const messages = agent.state.messages;
  return { value: finalText(messages), usage: sumUsage(messages), toolCalls };
}
