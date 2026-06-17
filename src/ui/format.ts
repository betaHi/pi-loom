/**
 * Shared, pure number-formatting helpers for pi-loom's progress UI.
 *
 * Both renderers (ANSI terminal + HTML web) format tokens and durations the
 * same way, so the logic lives here. ANSI-only concerns (color codes, visible
 * width, truncation) stay in render-ansi.ts; the web side uses CSS instead.
 */

/** 48700 → "48.7k", 376 → "376". */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
}

/** 28000ms → "28s", 330000ms → "5m30s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;
}
