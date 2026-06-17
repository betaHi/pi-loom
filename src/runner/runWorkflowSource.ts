/**
 * Run a workflow from a script STRING (authored at runtime, e.g. by an LLM).
 *
 * This is the "Claude writes the script for the task" path. The string is parsed
 * with acorn, statically checked for determinism, then executed in a `node:vm`
 * sandbox whose globals are ONLY the injected workflow primitives plus a few safe
 * builtins. The orchestration underneath (`runWorkflow`) is reused unchanged —
 * this module owns only the parse + sandbox step.
 *
 * Why a sandbox (not a hard one): the script is written by the HOST's own model
 * and runs in the host's process, which already executes arbitrary agent code —
 * so the threat model is not "malicious third-party code". The value here is
 *   1. DETERMINISM — `Date.now()`/`Math.random()`/`new Date()` are rejected at
 *      parse time, so the same script + args replays identically (resume).
 *   2. FOOT-GUN GUARD — `require`/`import`/`process`/`fs` are simply not in scope,
 *      so a model can't accidentally reach the host. (vm is not escape-proof, but
 *      that's acceptable given the trust model.)
 */

import vm from "node:vm";
import { parse, type Node } from "acorn";
import type { RunOptions, RunResult, WorkflowContext } from "../types.ts";
import { runWorkflow } from "./runWorkflow.ts";

type AnyNode = Node & { [key: string]: unknown };

const NONDETERMINISM =
  "Workflow scripts must be deterministic: Date.now() / Math.random() / new Date() are unavailable.";
const NO_LOADERS = "Workflow scripts cannot use require / import / dynamic loaders.";

function isCall(node: AnyNode, object: string, property: string): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee as AnyNode | undefined;
  return (
    callee?.type === "MemberExpression" &&
    (callee.object as AnyNode)?.type === "Identifier" &&
    (callee.object as { name?: string }).name === object &&
    (callee.property as AnyNode)?.type === "Identifier" &&
    (callee.property as { name?: string }).name === property
  );
}

function astChildren(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v === "object" && "type" in v) out.push(v as AnyNode);
    } else if (value && typeof value === "object" && "type" in (value as object)) {
      out.push(value as AnyNode);
    }
  }
  return out;
}

/** Statically reject non-determinism and dynamic loaders. */
function assertSafe(node: AnyNode): void {
  if (isCall(node, "Date", "now") || isCall(node, "Math", "random")) throw new Error(NONDETERMINISM);
  if (node.type === "NewExpression" && (node.callee as { name?: string })?.name === "Date") {
    throw new Error(NONDETERMINISM);
  }
  if (node.type === "ImportExpression") throw new Error(NO_LOADERS);
  if (node.type === "CallExpression" && (node.callee as { name?: string })?.name === "require") {
    throw new Error(NO_LOADERS);
  }
  for (const child of astChildren(node)) assertSafe(child);
}

/**
 * Parse + validate an LLM-authored script string into a WorkflowScript that runs
 * the body inside a vm sandbox with the given ctx's primitives in scope.
 *
 * The script body uses the primitives directly, e.g.
 *   `phase("Find"); return await agent("...");`
 * An explicit `return` produces the result.
 */
export function compileWorkflowScript<Args = unknown, Result = unknown>(
  source: string,
): (ctx: WorkflowContext<Args>) => Promise<Result> {
  let ast: AnyNode;
  try {
    ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode;
  } catch (err) {
    throw new Error(`Workflow script failed to parse: ${(err as Error).message}`);
  }
  assertSafe(ast);

  // Wrap the body in an async IIFE so top-level await/return work inside the vm.
  const wrapped = `(async () => {\n${source}\n})()`;

  return (ctx) => {
    const sandbox = vm.createContext({
      // Injected workflow primitives (the only way to reach the outside world).
      agent: ctx.agent,
      parallel: ctx.parallel,
      pipeline: ctx.pipeline,
      phase: ctx.phase,
      log: ctx.log,
      budget: ctx.budget,
      args: ctx.args,
      // Safe, deterministic builtins.
      JSON,
      Math,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Set,
      Map,
      Promise,
      console: { log: ctx.log, info: ctx.log, warn: ctx.log, error: ctx.log },
    });
    return new vm.Script(wrapped, { filename: "workflow.js" }).runInContext(sandbox) as Promise<Result>;
  };
}

/**
 * Compile and run a workflow from a script string. Thin wrapper over
 * runWorkflow — same options, same result.
 */
export function runWorkflowSource<Args = unknown, Result = unknown>(
  source: string,
  options: RunOptions<Args> = {},
): Promise<RunResult<Result>> {
  return runWorkflow(compileWorkflowScript<Args, Result>(source), options);
}

/**
 * Statically extract the phase titles an LLM-authored script declares, in source
 * order, deduped. A script calls `phase("Discover")`, `phase("Verify")`, … as it
 * runs; without this the progress panel only learns a phase once execution
 * reaches it, so future phases can't be listed. Pull every `phase("<literal>")`
 * call out of the AST up front and a host can seed the panel with the full plan
 * (all phases visible, current highlighted, pending greyed, done checked) —
 * matching Claude's /workflows view.
 *
 * Only string-LITERAL titles are extracted (a dynamically-built title can't be
 * known before the call runs); those still appear live when executed. Returns []
 * for an unparseable script rather than throwing — this is display sugar, not a
 * correctness gate.
 */
export function extractPhases(source: string): string[] {
  let ast: AnyNode;
  try {
    ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode;
  } catch {
    return [];
  }

  const titles: string[] = [];
  const seen = new Set<string>();
  const visit = (node: AnyNode): void => {
    if (
      node.type === "CallExpression" &&
      (node.callee as { type?: string; name?: string })?.type === "Identifier" &&
      (node.callee as { name?: string }).name === "phase"
    ) {
      const arg = (node.arguments as AnyNode[] | undefined)?.[0] as
        | { type?: string; value?: unknown }
        | undefined;
      if (arg?.type === "Literal" && typeof arg.value === "string" && !seen.has(arg.value)) {
        seen.add(arg.value);
        titles.push(arg.value);
      }
    }
    for (const child of astChildren(node)) visit(child);
  };
  visit(ast);
  return titles;
}
