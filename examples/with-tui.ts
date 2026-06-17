/**
 * Live TUI demo — no API key, no network.
 *
 * Renders the workflow panel as one phase tree (every phase listed, current
 * highlighted, each phase's sub-agents nested beneath it with model badge /
 * tokens / tools / elapsed) against a deterministic fake model. Run it in a REAL
 * terminal and screenshot the panel:
 *
 *   npx tsx examples/with-tui.ts
 */

import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { runWorkflowSource, renderWorkflowTUI } from "../src/index.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Fake model with latency + variable tokens; one call fails to show a ✗.
// Latency is generous so a mid-run frame (mixed ✓ / ● spinners) is easy to
// screenshot in a real terminal.
let n = 0;
const fakeComplete = async (_m: Model<any>, ctx: Context): Promise<AssistantMessage> => {
  await sleep(1400 + (n % 6) * 500); // staggered, slow enough to watch
  const i = n++;
  const prompt = typeof ctx.messages[0]?.content === "string" ? ctx.messages[0].content : "";
  if (prompt.includes("vite.config")) throw new Error("simulated error"); // → ✗
  const output = 40000 + ((i * 1700) % 12000);
  return {
    role: "assistant",
    content: [{ type: "text", text: `done ${i}` }],
    api: "anthropic-messages",
    provider: "anthropic" as never,
    model: "faux",
    usage: { input: 2000, output, cacheRead: 0, cacheWrite: 0, totalTokens: 2000 + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop" as never,
    timestamp: 1_700_000_000_000,
  };
};

const FILES = ["package.json", "vite.config.ts", "tsconfig.json", "index.tsx", "appStore.ts", "reactivity.ts", "setupTests.ts", ".eslintrc.cjs"];

// LLM-style script string — what `run_workflow` would receive.
const script = `
  phase("Inventory");
  await parallel(args.files.map(f => () => agent("inventory " + f, { label: "scan:" + f, phase: "Inventory" })));

  phase("Pattern Analysis");
  await parallel(args.files.slice(0,6).map(f => () => agent("analyze " + f, { label: "pattern:" + f, phase: "Pattern Analysis" })));

  phase("Infrastructure");
  await parallel(args.files.map(f => () => agent("port " + f, { label: "infra:" + f, phase: "Infrastructure" })));

  phase("Migrate Core");
  await parallel(args.files.slice(0,4).map(f => () => agent("migrate " + f, { label: "core:" + f, phase: "Migrate Core" })));

  phase("Verify & Report");
  return await agent("write the report", { label: "report" });
`;

const tui = await renderWorkflowTUI({
  name: "react-to-solid-migration",
  description: "Non-destructive React→Solid.js port of Excalidraw into solid-migration/, across 5 phases",
  phases: [
    { title: "Inventory" },
    { title: "Pattern Analysis" },
    { title: "Infrastructure" },
    { title: "Migrate Core" },
    { title: "Verify & Report" },
  ],
});

const { stats } = await runWorkflowSource(script, {
  args: { files: FILES },
  model: { api: "anthropic-messages", name: "Opus 4.8 (1M context)" } as Model<any>,
  completeFn: fakeComplete,
  concurrency: 6,
  onEvent: tui.onEvent,
});
tui.stop();

console.log(`\nDone. ${stats.agentCalls} agents · ${stats.outputTokens} output tokens`);
