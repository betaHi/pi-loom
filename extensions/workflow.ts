/**
 * pi extension: pi-loom.
 *
 * Registers ONE LLM-callable tool, `run_workflow`. When a pi user asks for
 * something big ("run a workflow to audit every API route under src/ for missing
 * auth checks"), pi's model writes an orchestration script and calls this tool
 * with it; we execute it on the host's model (ctx.model) with pi's file tools
 * wired in, so sub-agents can read the repo. No extra config — sub-agents run on
 * the host's model and inherit its credentials from the environment.
 *
 * Load it:  pi -e ./extensions/workflow.ts   (or, installed: pi install npm:pi-loom)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createReadToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, runWorkflowSource, extractPhases, renderWorkflowTUI, type AgentTool } from "../src/index.ts";

const PARAMETERS = Type.Object({
  script: Type.String({
    description:
      "A JavaScript dynamic-workflow script body. It runs as an async function " +
      "with these injected primitives in scope:\n" +
      "  agent(prompt, opts?)  — run one sub-agent. opts: {label, phase, schema, tools, retries}. " +
      "Returns the assistant text, or a validated object when opts.schema (a TypeBox schema) is given, " +
      "or null on failure (filter nulls).\n" +
      "  parallel(thunks)      — run [() => Promise]s concurrently, awaits all (barrier).\n" +
      "  pipeline(items, ...stages) — each item flows through all stages independently (no barrier).\n" +
      "  phase(title) / log(msg) — progress grouping + messages.\n" +
      "  budget                — {total, spent(), remaining()} output-token budget.\n" +
      "Sub-agents already have file tools (read/grep/find/ls) — they can inspect the repo. " +
      "Use phase() to label stages, parallel() to fan out, and `return` the final result.\n" +
      "\nGUIDELINES for a good script (follow these):\n" +
      "  • FAN OUT the work: when a stage covers N independent items (files, packages, " +
      "modules, questions), start one sub-agent PER item with parallel(items.map(x => () => " +
      "agent(...))). Do NOT cram the whole job into one giant agent — that is slow and may " +
      "overflow the output limit and come back empty.\n" +
      "  • Keep each agent focused and small; return concise notes, not a full report.\n" +
      "  • opts.label must be a SHORT identifier (e.g. \"inspect:pi-ai\"), never a sentence and " +
      "never the agent's output.\n" +
      "  • Declare every stage with phase(\"…\") up front so progress shows the full plan.\n" +
      "  • Do the final synthesis yourself from the returned notes if it would be large; the " +
      "workflow should `return` the structured findings, not a 5000-word essay from one agent.\n" +
      "  • Never use require() or import() — they are blocked.",
  }),
  task: Type.Optional(
    Type.String({ description: "Short human-readable description of what the workflow does." }),
  ),
});

export default function dynamicPiWorkflow(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "run_workflow",
    label: "Run dynamic workflow",
    description:
      "Orchestrate many sub-agents to take on a task too big for one pass — codebase-wide " +
      "audits, multi-file migrations, or cross-checked research. You write a short " +
      "orchestration script (see the `script` parameter) that fans work out across sub-agents " +
      "and verifies results, and this tool runs it and returns the final result. " +
      "Prefer this over doing large multi-file work yourself turn by turn.",
    parameters: PARAMETERS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
      const { script, task } = params as { script: string; task?: string };

      if (!ctx.model) {
        return {
          content: [{ type: "text" as const, text: "No model is active in this pi session." }],
          details: undefined,
        };
      }

      // Sub-agents get pi's read-only file tools so they can inspect the repo.
      const fileTools = [
        createReadToolDefinition(ctx.cwd),
        createGrepToolDefinition(ctx.cwd),
        createFindToolDefinition(ctx.cwd),
        createLsToolDefinition(ctx.cwd),
      ] as unknown as AgentTool<any>[];

      const tui = await renderWorkflowTUI({
        name: "run_workflow",
        description: task ?? "dynamic workflow",
        // Pre-seed the phase list (all phases shown up front, not revealed one at
        // a time) by statically extracting every phase("…") declared in the script.
        phases: extractPhases(script).map((title) => ({ title })),
      });

      try {
        const { result, stats } = await runWorkflowSource(script, {
          model: ctx.model,
          tools: fileTools,
          signal,
          concurrency: 16,
          onEvent: tui.onEvent,
        });
        tui.stop();

        const summary =
          typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Workflow complete — ${stats.agentCalls} agents, ` +
                `${stats.outputTokens} output tokens.\n\n${summary}`,
            },
          ],
          details: { stats },
        };
      } catch (err) {
        tui.stop();
        return {
          content: [
            { type: "text" as const, text: `Workflow failed: ${(err as Error).message}` },
          ],
          details: undefined,
        };
      }
    },
  });
}
