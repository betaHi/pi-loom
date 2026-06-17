/**
 * Public types for pi-loom.
 *
 * The workflow API faithfully clones Claude Code's dynamic-workflow primitives
 * (agent / parallel / pipeline / phase / log / budget) but runs on the open-source
 * `pi` agent harness (@earendil-works/pi-agent-core + pi-ai).
 */

import type { Model, TSchema, Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

/** Reasoning effort, mapped to pi's `thinkingLevel`. */
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Options for a single agent() call. Mirrors Claude's agent() opts.
 * `schema` is the structured-output contract: when present, the agent is forced
 * to return a validated object matching it (instead of free text).
 */
export interface AgentOpts<S extends TSchema = TSchema> {
  /** Display label for progress events (defaults to a truncated prompt). */
  label?: string;
  /** Phase to group this agent under (defaults to the current phase()). */
  phase?: string;
  /** TypeBox schema forcing structured JSON output. */
  schema?: S;
  /** Override the run's default model for this agent only. */
  model?: Model<any>;
  /** Override reasoning effort for this agent only. */
  effort?: Effort;
  /** Named system-prompt preset from the agent registry. */
  agentType?: string;
  /**
   * Tools the sub-agent may call (e.g. pi's file tools, so it can read a repo).
   * When present, the agent runs pi's multi-turn tool loop instead of a single
   * completion. Not combinable with `schema` in v0.
   */
  tools?: AgentTool<any>[];
  /** Not implemented in v0 (pi has no git-worktree concept). Reserved. */
  isolation?: "worktree";
  /** Max retries on provider error / schema-validation failure (default 2). */
  retries?: number;
}

/**
 * Return type of agent(): the validated object when a schema is given,
 * otherwise the final assistant text. `null` when the agent dies after retries
 * — callers filter with `.filter(Boolean)`, matching Claude semantics.
 */
export type AgentResult<S extends TSchema | undefined> = S extends TSchema
  ? Static<S> | null
  : string | null;

/**
 * The agent() primitive injected into a workflow script.
 *
 * Overloaded so the return type narrows on schema presence:
 *   - agent(prompt, { schema })  → Promise<Static<schema> | null>
 *   - agent(prompt)              → Promise<string | null>
 * `null` means the agent died after retries (callers `.filter(Boolean)`).
 */
export interface AgentFn {
  <S extends TSchema>(prompt: string, opts: AgentOpts<S> & { schema: S }): Promise<Static<S> | null>;
  (prompt: string, opts?: AgentOpts): Promise<string | null>;
}

/** A thunk for parallel(): a 0-arg function returning a promise. */
export type Thunk<T> = () => Promise<T>;

/** parallel(): run thunks concurrently with a barrier (awaits all). */
export type ParallelFn = <T>(thunks: Array<Thunk<T>>) => Promise<Array<T | null>>;

/**
 * A pipeline stage. Receives the previous stage's result, the original item,
 * and the item index. The first stage's `prev` equals the item.
 */
export type Stage<TIn, TOut> = (
  prev: TIn,
  originalItem: unknown,
  index: number,
) => Promise<TOut> | TOut;

/**
 * pipeline(): each item flows through all stages independently — NO barrier
 * between stages. A stage that throws drops that item to null.
 * Typed for up to 4 stages; a variadic fallback covers more.
 */
export interface PipelineFn {
  <A, B>(items: A[], s1: Stage<A, B>): Promise<Array<B | null>>;
  <A, B, C>(items: A[], s1: Stage<A, B>, s2: Stage<B, C>): Promise<Array<C | null>>;
  <A, B, C, D>(
    items: A[],
    s1: Stage<A, B>,
    s2: Stage<B, C>,
    s3: Stage<C, D>,
  ): Promise<Array<D | null>>;
  <A, B, C, D, E>(
    items: A[],
    s1: Stage<A, B>,
    s2: Stage<B, C>,
    s3: Stage<C, D>,
    s4: Stage<D, E>,
  ): Promise<Array<E | null>>;
  (items: unknown[], ...stages: Array<Stage<any, any>>): Promise<Array<unknown | null>>;
}

/** Token budget handle exposed to scripts. */
export interface Budget {
  /** Configured ceiling, or null if unbounded. */
  readonly total: number | null;
  /** Output tokens spent so far across all agents. */
  spent(): number;
  /** Remaining tokens (Infinity if unbounded). */
  remaining(): number;
}

/** phase() / log() injected helpers. */
export type PhaseFn = (title: string) => void;
export type LogFn = (message: string) => void;

/** The object injected into every workflow script. */
export interface WorkflowContext<Args = unknown> {
  agent: AgentFn;
  parallel: ParallelFn;
  pipeline: PipelineFn;
  phase: PhaseFn;
  log: LogFn;
  budget: Budget;
  /** The value passed as runWorkflow(..., { args }). */
  args: Args;
}

/** A workflow script: an async function over the injected context. */
export type WorkflowScript<Args = unknown, Result = unknown> = (
  ctx: WorkflowContext<Args>,
) => Promise<Result>;

/** Optional metadata describing a workflow (mirrors Claude's `meta` block). */
export interface WorkflowMeta {
  name: string;
  description?: string;
  phases?: Array<{ title: string; detail?: string }>;
}

/** Progress events emitted during a run (subscribe via RunOptions.onEvent). */
export type WorkflowEvent =
  | { type: "phase"; title: string }
  | { type: "log"; message: string }
  | { type: "agent_start"; label: string; phase: string; callIndex: number; model?: string }
  | {
      type: "agent_end";
      label: string;
      phase: string;
      callIndex: number;
      outputTokens: number;
      tools?: number;
      cached: boolean;
      ok: boolean;
    }
  | { type: "budget"; spent: number; remaining: number };

/** Options for runWorkflow(). */
export interface RunOptions<Args = unknown> {
  /** Input exposed to the script as `args`. */
  args?: Args;
  /** Optional metadata (name/description/phases) — drives the TUI header + phase list. */
  meta?: WorkflowMeta;
  /** Default model for all agents (required unless every agent passes its own). */
  model?: Model<any>;
  /** Default reasoning effort for all agents. */
  effort?: Effort;
  /** Max concurrent agents across parallel/pipeline/nested (default 16). */
  concurrency?: number;
  /** Hard cap on total agents per run (default 1000). */
  maxAgents?: number;
  /** Output-token budget; agent() throws once spent reaches it. */
  budget?: number;
  /** Path to a JSON journal file; when set, enables resume from cached results. */
  journalPath?: string;
  /** Progress callback. */
  onEvent?: (event: WorkflowEvent) => void;
  /** Registry of named system prompts for opts.agentType. */
  agentTypes?: Record<string, string>;
  /** Default system prompt when no agentType is given. */
  systemPrompt?: string;
  /** Tools available to every agent by default (e.g. pi file tools). */
  tools?: AgentTool<any>[];
  /** Abort signal forwarded to tool-using agents. */
  signal?: AbortSignal;
  /**
   * Test seam: override the underlying pi completion function. Defaults to pi's
   * `complete`. Lets unit tests run a whole workflow without a real API key.
   * @internal
   */
  completeFn?: import("./core/schema.ts").CompleteFn;
  /**
   * Extra options merged into every underlying complete() call — e.g. an explicit
   * `apiKey`. The pi extension passes the host session's resolved credentials here
   * so sub-agents authenticate like the host, without touching the model object.
   */
  completeOptions?: Record<string, unknown>;
  /**
   * Host credential resolver for tool-using sub-agents. Forwarded to pi's `Agent`
   * as `getApiKey`. Use it when the host resolves provider keys some way other
   * than the environment — e.g. a pi `ModelRegistry` keyed by a custom provider
   * name (`(p) => modelRegistry.getApiKeyForProvider(p)`). Without it, a sub-agent
   * whose model uses a custom provider can't authenticate and its tool loop
   * returns empty. The non-tool path uses `completeOptions.apiKey` instead.
   */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /**
   * Cap (ms) on how long a tool-using sub-agent honors a provider-requested retry
   * delay, forwarded to pi's `Agent` as `maxRetryDelayMs`. A provider that rejects
   * an over-large request (e.g. a 408 "request body too large") may ask to retry
   * after a long wait; without a cap the sub-agent can retry indefinitely without
   * ever finishing, stalling the run. Set this so it gives up and the agent fails
   * cleanly (its result becomes `null`, which callers `.filter(Boolean)`).
   */
  maxRetryDelayMs?: number;
}

/** Aggregate run statistics (mirrors the deep-research stats shape). */
export interface RunStats {
  agentCalls: number;
  cachedCalls: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

/** Result of runWorkflow(). */
export interface RunResult<Result = unknown> {
  result: Result;
  stats: RunStats;
}
