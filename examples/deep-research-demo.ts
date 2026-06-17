/**
 * Key-free end-to-end demo.
 *
 * Runs the FULL deep-research orchestration (Scope → Research pipeline →
 * 3-vote adversarial Verify → Synthesize) against a deterministic fake model —
 * no API key, no network. This proves the workflow layer end-to-end:
 *   - schema-forced structured output (scope/claims/verdict/report)
 *   - parallel fan-out + barrier (verify)
 *   - pipeline no-barrier (research)
 *   - budget accounting + stats
 *   - the deterministic agentCalls formula
 *
 * Run: npx tsx examples/deep-research-demo.ts
 *      (or: npm run build && node dist-examples… — but tsx is simplest)
 */

import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { runWorkflow, Type, RESPOND_TOOL_NAME, type WorkflowContext } from "../src/index.ts";

// ---- Schemas (same as the real port) ----
const ScopeSchema = Type.Object({
  angles: Type.Array(Type.Object({ label: Type.String(), focus: Type.String() }), {
    minItems: 3,
    maxItems: 5,
  }),
});
const ClaimsSchema = Type.Object({
  claims: Type.Array(Type.Object({ claim: Type.String(), importance: Type.String() }), {
    maxItems: 4,
  }),
});
const VerdictSchema = Type.Object({ refuted: Type.Boolean(), reason: Type.String() });
const ReportSchema = Type.Object({ summary: Type.String(), findings: Type.Array(Type.String()) });

const VOTES = 3;
const ANGLES = 3;
const CLAIMS_PER_ANGLE = 2;

// ---- Deterministic fake completeFn: routes by what the prompt asks for ----
const EMPTY_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
function msg(content: AssistantMessage["content"], output: number): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic" as never,
    model: "faux",
    usage: { input: 50, output, cacheRead: 0, cacheWrite: 0, totalTokens: 50 + output, cost: { ...EMPTY_COST } },
    stopReason: content.some((c) => c.type === "toolCall") ? ("toolUse" as never) : ("stop" as never),
    timestamp: 1_700_000_000_000,
  };
}
function tool(args: Record<string, unknown>, output: number): AssistantMessage {
  return msg([{ type: "toolCall", id: "t", name: RESPOND_TOOL_NAME, arguments: args }], output);
}

let refuteToggle = 0;
const fakeComplete = async (_m: Model<any>, ctx: Context): Promise<AssistantMessage> => {
  const prompt = typeof ctx.messages[0]?.content === "string" ? ctx.messages[0].content : "";

  if (prompt.includes("investigation angles")) {
    return tool(
      {
        angles: Array.from({ length: ANGLES }, (_, i) => ({
          label: `angle-${i + 1}`,
          focus: `focus ${i + 1}`,
        })),
      },
      40,
    );
  }
  if (prompt.startsWith("Research angle")) {
    return msg([{ type: "text", text: "Some findings about this angle. Evidence suggests X and Y." }], 60);
  }
  if (prompt.includes("extract up to 4")) {
    return tool(
      {
        claims: Array.from({ length: CLAIMS_PER_ANGLE }, (_, i) => ({
          claim: `claim ${i + 1} from this angle`,
          importance: "central",
        })),
      },
      30,
    );
  }
  if (prompt.includes("REFUTE")) {
    // Refute ~1 in 3 votes so most claims survive (2/3 rule) — exercises both paths.
    const refuted = refuteToggle++ % 3 === 0;
    return tool({ refuted, reason: refuted ? "weak evidence" : "holds up" }, 15);
  }
  if (prompt.includes("Synthesize")) {
    return tool({ summary: "Synthesized answer.", findings: ["finding A", "finding B"] }, 50);
  }
  return msg([{ type: "text", text: "(unhandled)" }], 5);
};

// ---- The workflow script (identical shape to the real port) ----
const script = async (ctx: WorkflowContext<string>) => {
  const { agent, parallel, pipeline, phase, log } = ctx;
  const question = ctx.args;

  phase("Scope");
  const scope = await agent(
    `Decompose this research question into 3-5 complementary investigation angles.\n\nQuestion: ${question}`,
    { schema: ScopeSchema, label: "scope" },
  );
  if (!scope) throw new Error("scope failed");
  log(`${scope.angles.length} angles: ${scope.angles.map((a) => a.label).join(", ")}`);

  phase("Research");
  const perAngle = await pipeline(
    scope.angles,
    (angle: { label: string; focus: string }) =>
      agent(`Research angle "${angle.label}": ${question}`, {
        label: `investigate:${angle.label}`,
        phase: "Research",
      }),
    (findings: string | null, angle: any) =>
      agent(`From these findings, extract up to 4 concrete claims.\n${findings}`, {
        schema: ClaimsSchema,
        label: `extract:${angle.label}`,
        phase: "Research",
      }),
  );
  const claims = perAngle
    .filter(Boolean)
    .flatMap((c: any) => c.claims as Array<{ claim: string }>);
  log(`extracted ${claims.length} claims → ${VOTES}-vote verify each`);

  phase("Verify");
  const verified = await parallel(
    claims.map((c) => async () => {
      const votes = await parallel(
        Array.from({ length: VOTES }, (_, v) => () =>
          agent(`Be SKEPTICAL. Try to REFUTE: "${c.claim}"`, {
            schema: VerdictSchema,
            label: `v${v}`,
            phase: "Verify",
          }),
        ),
      );
      const refutes = votes.filter((x) => x?.refuted).length;
      const survives = refutes < 2;
      log(`"${c.claim}": ${VOTES - refutes}-${refutes} ${survives ? "✓" : "✗"}`);
      return survives ? c : null;
    }),
  );
  const confirmed = verified.filter(Boolean) as Array<{ claim: string }>;

  phase("Synthesize");
  const report = await agent(
    `Synthesize a report answering: ${question}\nClaims:\n${confirmed.map((c) => c.claim).join("\n")}`,
    { schema: ReportSchema, label: "synthesize" },
  );

  return { confirmed: confirmed.length, report };
};

// ---- Run it ----
const { result, stats } = await runWorkflow(script, {
  args: "How do LangGraph, CrewAI, and LlamaIndex Workflows compare?",
  model: { api: "anthropic-messages" } as Model<any>,
  concurrency: 8,
  budget: 1_000_000,
  completeFn: fakeComplete,
  onEvent: (e) => {
    if (e.type === "phase") console.log(`\n━━ ${e.title} ━━`);
    else if (e.type === "log") console.log(`  ${e.message}`);
  },
});

console.log("\n=== RESULT ===");
console.log(JSON.stringify(result, null, 2));

// Verify the deterministic agentCalls formula:
//   1 (scope) + ANGLES (investigate) + ANGLES (extract) + claims*VOTES + 1 (synth)
const claimsTotal = ANGLES * CLAIMS_PER_ANGLE;
const expected = 1 + ANGLES + ANGLES + claimsTotal * VOTES + 1;
console.log("\n=== STATS ===");
console.log(stats);
console.log(`\nagentCalls = ${stats.agentCalls}, expected = ${expected} →`, stats.agentCalls === expected ? "✓ MATCH" : "✗ MISMATCH");
console.log(`outputTokens = ${stats.outputTokens}`);
