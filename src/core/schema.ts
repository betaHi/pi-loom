/**
 * Structured output for pi-loom.
 *
 * pi-ai has no native "JSON mode". The idiomatic pattern (and the one Claude's
 * workflow agents use conceptually) is:
 *   1. Wrap the desired output schema in a SINGLE tool ("respond").
 *   2. Force the model to call that tool (provider-specific tool_choice).
 *   3. Validate the tool-call arguments against the schema (TypeBox).
 *   4. Return the validated object.
 *
 * This module owns that round-trip and the cross-provider tool_choice shaping.
 */

import {
  type Model,
  type TSchema,
  type Static,
  type Tool,
  type Context,
  type AssistantMessage,
  type ToolCall,
  complete,
  validateToolCall,
} from "@earendil-works/pi-ai";

/**
 * The completion function signature, injectable for testing. Defaults to pi's
 * `complete`. Tests pass a fake that returns a canned AssistantMessage.
 */
export type CompleteFn = (
  model: Model<any>,
  context: Context,
  options?: Record<string, unknown>,
) => Promise<AssistantMessage>;

/** Name of the synthetic tool the model is forced to call. */
export const RESPOND_TOOL_NAME = "respond";

/**
 * Build the provider-correct `tool_choice` value that forces our single
 * `respond` tool. Anthropic and OpenAI-completions disagree on the shape;
 * everything else falls back to a string the provider understands, or the
 * named form. Since there is only ONE tool in context, "any"/"required" are
 * equivalent to naming it, but naming is the most reliable.
 */
function forcedToolChoice(model: Model<any>): unknown {
  const api = String(model.api);
  if (api.includes("anthropic")) {
    return { type: "tool", name: RESPOND_TOOL_NAME };
  }
  if (api.includes("openai") || api.includes("completions") || api.includes("responses")) {
    return { type: "function", function: { name: RESPOND_TOOL_NAME } };
  }
  // Google / Mistral / others: a bare "required"/"any" is the safest generic.
  // The model still only has one tool, so it must call `respond`.
  return "required";
}

/** Extract the first toolCall named `respond` from an assistant message. */
function findRespondCall(message: AssistantMessage): ToolCall | undefined {
  return message.content.find(
    (c): c is ToolCall => c.type === "toolCall" && c.name === RESPOND_TOOL_NAME,
  );
}

/** Extract plain text from an assistant message (for error diagnostics). */
export function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

export interface StructuredResult<T> {
  value: T;
  usage: AssistantMessage["usage"];
}

/**
 * Run one model call that is forced to emit JSON matching `schema`, validate it,
 * and return the typed object plus token usage.
 *
 * Throws on provider error or validation failure — the caller (agent.ts) owns
 * the retry/null policy.
 */
export async function completeStructured<S extends TSchema>(
  model: Model<any>,
  systemPrompt: string,
  prompt: string,
  schema: S,
  options?: Record<string, unknown>,
  completeFn: CompleteFn = complete,
): Promise<StructuredResult<Static<S>>> {
  const respondTool: Tool = {
    name: RESPOND_TOOL_NAME,
    description:
      "Return your final answer as a single structured object matching the schema. " +
      "Call this tool exactly once with the complete result.",
    parameters: schema,
  };

  const context = {
    systemPrompt,
    messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }],
    tools: [respondTool],
  };

  // Force the single `respond` tool. Some models (e.g. with extended thinking
  // on) reject a forced tool_choice — "Thinking may not be enabled when
  // tool_choice forces tool use." Since there is only ONE tool in context, the
  // model reliably calls it even WITHOUT forcing, so we fall back to an
  // unforced call on that class of error rather than failing the agent.
  let message: AssistantMessage;
  try {
    message = await completeFn(model, context, { ...options, toolChoice: forcedToolChoice(model) });
    if (message.stopReason === "error") {
      throw new Error(message.errorMessage ?? "provider error");
    }
  } catch (err) {
    if (!isForcedToolChoiceConflict(err)) throw err;
    // Retry without forcing — the lone tool still elicits the call.
    message = await completeFn(model, context, options);
  }

  const call = findRespondCall(message);
  if (!call) {
    const text = assistantText(message).slice(0, 200);
    throw new Error(
      `Model did not call the '${RESPOND_TOOL_NAME}' tool (stopReason=${message.stopReason}). ` +
        (text ? `Text was: ${text}` : "No text returned."),
    );
  }

  // validateToolCall compiles the schema, coerces, and throws on mismatch.
  const value = validateToolCall([respondTool], call) as Static<S>;
  return { value, usage: message.usage };
}

/** Detect the "thinking + forced tool_choice" provider conflict (any wording). */
function isForcedToolChoiceConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /tool_choice|tool choice/i.test(msg) && /thinking|forces tool|may not/i.test(msg);
}
