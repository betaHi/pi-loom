/**
 * runWorkflow() — the orchestration entry point.
 *
 * Builds the injected context (agent / parallel / pipeline / phase / log /
 * budget / args), runs the script, and returns its result plus aggregate stats.
 *
 * Wiring responsibilities that live HERE (kept out of the pure primitives):
 *   - the concurrency pool gates each agent() call
 *   - the budget is checked before each agent and credited after
 *   - the journal short-circuits agent() on a cache hit (resume)
 *   - progress events flow to onEvent
 */

import { complete, type AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentOpts,
  RunOptions,
  RunResult,
  RunStats,
  WorkflowContext,
  WorkflowScript,
} from "../types.ts";
import { AgentPool } from "../core/pool.ts";
import { BudgetTracker } from "../core/budget.ts";
import { PhaseTracker } from "../core/phases.ts";
import { Journal, journalKey } from "./journal.ts";
import { makeParallel } from "../core/parallel.ts";
import { makePipeline } from "../core/pipeline.ts";
import { runAgent, type AgentRunDeps } from "../core/agent.ts";

const DEFAULT_SYSTEM_PROMPT =
  "You are a focused worker agent inside an automated workflow. " +
  "Do exactly what the task asks. Your output is consumed by code, not shown to a human — " +
  "be precise and follow any requested format exactly.";

function labelFor(prompt: string, opts: AgentOpts | undefined): string {
  if (opts?.label) return opts.label;
  const firstLine = prompt.split("\n", 1)[0] ?? "";
  return firstLine.slice(0, 60);
}

export async function runWorkflow<Args = unknown, Result = unknown>(
  script: WorkflowScript<Args, Result>,
  options: RunOptions<Args> = {},
): Promise<RunResult<Result>> {
  const pool = new AgentPool(options.concurrency ?? 16, options.maxAgents ?? 1000);
  const budget = new BudgetTracker(options.budget ?? null);
  const phases = new PhaseTracker(options.onEvent ?? (() => {}));
  const journal = new Journal(options.journalPath);

  const stats: RunStats = {
    agentCalls: 0,
    cachedCalls: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };

  // Monotonic agent-call counter — drives journal keys (position-sensitive
  // resume) and is independent of scheduling order, so it must be assigned
  // synchronously at call time, before any await.
  let callIndex = -1;

  const baseDeps: Omit<AgentRunDeps, "onUsage" | "checkBudget"> = {
    defaultModel: options.model,
    defaultEffort: options.effort,
    systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    agentTypes: options.agentTypes,
    defaultTools: options.tools,
    completeFn: options.completeFn ?? complete,
    completeOptions: options.completeOptions,
    getApiKey: options.getApiKey,
    maxRetryDelayMs: options.maxRetryDelayMs,
    signal: options.signal,
  };

  // Implemented with a loose signature (runAgent returns unknown), then exposed
  // through the typed AgentFn surface on the context below.
  const agent = async (prompt: string, opts?: AgentOpts): Promise<unknown> => {
    const myIndex = ++callIndex;
    const phase = opts?.phase ?? phases.currentPhase;
    const label = labelFor(prompt, opts);

    // Resume: a cached result short-circuits the whole call (no pool, no spend).
    const key = journal.enabled
      ? journalKey(myIndex, prompt, { ...opts, schema: undefined }, opts?.schema ?? null)
      : "";
    if (journal.enabled && journal.has(key)) {
      const entry = journal.get(key)!;
      stats.agentCalls++;
      stats.cachedCalls++;
      phases.event({
        type: "agent_end",
        label,
        phase,
        callIndex: myIndex,
        outputTokens: entry.outputTokens,
        cached: true,
        ok: entry.result !== null,
      });
      return entry.result;
    }

    const resolvedModel = opts?.model ?? options.model;
    const modelName = resolvedModel?.name ?? resolvedModel?.id;
    phases.event({ type: "agent_start", label, phase, callIndex: myIndex, model: modelName });

    let lastOutputTokens = 0;
    let toolCalls = 0;
    const deps: AgentRunDeps = {
      ...baseDeps,
      checkBudget: () => budget.check(),
      onToolCalls: (n) => { toolCalls = n; },
      onError: (err) => phases.log(`agent "${label}" error: ${(err as Error)?.message ?? err}`),
      onUsage: (usage: AssistantMessage["usage"]) => {
        lastOutputTokens = usage.output;
        budget.add(usage.output);
        stats.outputTokens += usage.output;
        stats.totalTokens += usage.totalTokens;
        stats.costUsd += usage.cost.total;
      },
    };

    // The pool gates concurrency at the agent() boundary (NOT in parallel()).
    const result = await pool.run(() => runAgent(prompt, opts, deps));

    stats.agentCalls++;
    if (journal.enabled) journal.set(key, { result, outputTokens: lastOutputTokens });

    phases.event({
      type: "agent_end",
      label,
      phase,
      callIndex: myIndex,
      outputTokens: lastOutputTokens,
      tools: toolCalls || undefined,
      cached: false,
      ok: result !== null,
    });
    phases.event({ type: "budget", spent: budget.spent(), remaining: budget.remaining() });

    return result;
  };

  const ctx: WorkflowContext<Args> = {
    agent: agent as WorkflowContext<Args>["agent"],
    parallel: makeParallel(),
    pipeline: makePipeline() as WorkflowContext<Args>["pipeline"],
    phase: (title: string) => phases.phase(title),
    log: (message: string) => phases.log(message),
    budget: budget.view(),
    args: options.args as Args,
  };

  const result = await script(ctx);
  return { result, stats };
}
