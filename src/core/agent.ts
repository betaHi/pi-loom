/**
 * The agent() primitive.
 *
 * Maps one agent call onto pi-ai's `complete()`:
 *   - no schema  → plain completion, return the assistant text
 *   - schema     → forced `respond` tool call, return the validated object
 *
 * This module owns ONLY: opts→pi mapping, retries, and the retries→null policy.
 * Budget accounting and journaling are layered on by the caller (runWorkflow)
 * via the `onUsage` / `checkBudget` hooks, keeping this module pure and testable.
 */

import {
  type Model,
  type TSchema,
  type Context,
  type AssistantMessage,
  complete,
} from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentOpts, Effort } from "../types.ts";
import { completeStructured, assistantText, type CompleteFn } from "./schema.ts";
import { runToolLoop } from "./agentLoop.ts";

export interface AgentRunDeps {
  /** Default model when opts.model is absent. */
  defaultModel?: Model<any>;
  /** Default effort when opts.effort is absent. */
  defaultEffort?: Effort;
  /** Default system prompt when no agentType resolves one. */
  systemPrompt: string;
  /** agentType → system prompt registry. */
  agentTypes?: Record<string, string>;
  /** Default tools for every agent (e.g. file tools); opts.tools overrides. */
  defaultTools?: AgentTool<any>[];
  /** Injectable completion (defaults to pi's complete); tests pass a fake. */
  completeFn?: CompleteFn;
  /** Extra options merged into every complete() call (e.g. the resolved apiKey). */
  completeOptions?: Record<string, unknown>;
  /**
   * Host credential resolver for tool-using sub-agents (the multi-turn Agent
   * loop). Forwarded to pi's `Agent` as `getApiKey`, so a sub-agent whose model
   * uses a custom provider name authenticates like the host. Without it the loop
   * falls back to env-key resolution.
   */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /**
   * Cap (ms) on how long a tool-using sub-agent honors a provider-requested
   * retry delay. Forwarded to pi's `Agent` as `maxRetryDelayMs`. Bounds the case
   * where a provider rejects an over-large request and asks to retry after a long
   * wait, which would otherwise stall the sub-agent indefinitely.
   */
  maxRetryDelayMs?: number;
  /** Called with usage after each successful model call (for budget/stats). */
  onUsage?: (usage: AssistantMessage["usage"]) => void;
  /** Called once with the resolved model name (for progress display). */
  onModel?: (modelName: string) => void;
  /** Called with the number of tool calls executed (tool-loop path only). */
  onToolCalls?: (count: number) => void;
  /** Throws if the budget is already exhausted (checked before spending). */
  checkBudget?: () => void;
  /** Called with each attempt's error (for diagnostics; the agent still retries). */
  onError?: (err: unknown, attempt: number) => void;
  /** Abort signal forwarded to tool-loop agents. */
  signal?: AbortSignal;
}

const DEFAULT_RETRIES = 2;

function resolveSystemPrompt(opts: AgentOpts | undefined, deps: AgentRunDeps): string {
  const preset = opts?.agentType ? deps.agentTypes?.[opts.agentType] : undefined;
  return preset ?? deps.systemPrompt;
}

function resolveModel(opts: AgentOpts | undefined, deps: AgentRunDeps): Model<any> {
  const model = opts?.model ?? deps.defaultModel;
  if (!model) {
    throw new Error(
      "agent() needs a model: pass `model` in runWorkflow options or in the agent opts.",
    );
  }
  return model;
}

/** Plain (no-schema) completion: return the assistant's text. */
async function completeText(
  model: Model<any>,
  systemPrompt: string,
  prompt: string,
  options: Record<string, unknown> | undefined,
  completeFn: CompleteFn,
): Promise<{ value: string; usage: AssistantMessage["usage"] }> {
  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  };
  const message = await completeFn(model, context, options);
  return { value: assistantText(message), usage: message.usage };
}

/**
 * Run one agent to completion with retries. Returns the result (validated object
 * if a schema was given, else text) or `null` if every attempt failed.
 *
 * `null` matches Claude semantics — callers do `.filter(Boolean)`.
 */
export async function runAgent<S extends TSchema = TSchema>(
  prompt: string,
  opts: AgentOpts<S> | undefined,
  deps: AgentRunDeps,
): Promise<unknown> {
  deps.checkBudget?.();

  const model = resolveModel(opts, deps);
  const systemPrompt = resolveSystemPrompt(opts, deps);
  const effort = opts?.effort ?? deps.defaultEffort;
  const completeFn = deps.completeFn ?? complete;
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const tools = opts?.tools ?? deps.defaultTools;

  deps.onModel?.(model.name ?? model.id ?? "model");

  // Effort maps directly onto pi's `reasoning` (same vocabulary); completeOptions
  // (e.g. apiKey) merge into every call. pi accepts arbitrary option keys.
  const options: Record<string, unknown> | undefined =
    effort || deps.completeOptions
      ? { ...deps.completeOptions, ...(effort ? { reasoning: effort } : {}) }
      : undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Three paths: tool-loop (sub-agent reads files), structured, or plain text.
      if (tools?.length) {
        const r = await runToolLoop(model, systemPrompt, prompt, tools, deps.signal, deps.getApiKey, deps.maxRetryDelayMs);
        deps.onToolCalls?.(r.toolCalls);
        deps.onUsage?.(r.usage);
        return r.value;
      }
      const { value, usage } = opts?.schema
        ? await completeStructured(model, systemPrompt, prompt, opts.schema, options, completeFn)
        : await completeText(model, systemPrompt, prompt, options, completeFn);
      deps.onUsage?.(usage);
      return value;
    } catch (err) {
      deps.onError?.(err, attempt);
      // Retry; on final failure fall through to the null return below.
    }
  }
  return null; // exhausted retries (Claude semantics: caller filters nulls)
}
