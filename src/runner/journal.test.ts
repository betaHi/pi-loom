import { describe, it, expect, afterEach } from "vitest";
import { rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal, journalKey } from "./journal.ts";

const tmpPath = join(tmpdir(), `dpw-journal-test-${process.pid}.json`);

afterEach(() => {
  if (existsSync(tmpPath)) rmSync(tmpPath);
});

describe("journalKey", () => {
  it("is stable regardless of opts key order", () => {
    const a = journalKey(0, "p", { schema: 1, phase: "X" }, null);
    const b = journalKey(0, "p", { phase: "X", schema: 1 }, null);
    expect(a).toBe(b);
  });

  it("changes when callIndex changes (position-sensitive)", () => {
    expect(journalKey(0, "p", {}, null)).not.toBe(journalKey(1, "p", {}, null));
  });

  it("changes when prompt changes", () => {
    expect(journalKey(0, "a", {}, null)).not.toBe(journalKey(0, "b", {}, null));
  });
});

describe("Journal", () => {
  it("is disabled when no path is given (never persists)", () => {
    const j = new Journal();
    expect(j.enabled).toBe(false);
    j.set("k", { result: "x", outputTokens: 1 });
    expect(j.has("k")).toBe(true); // in-memory still works
    expect(existsSync(tmpPath)).toBe(false);
  });

  it("persists and reloads entries across instances (resume)", () => {
    const j1 = new Journal(tmpPath);
    j1.set("k1", { result: { ok: true }, outputTokens: 42 });
    expect(existsSync(tmpPath)).toBe(true);

    const j2 = new Journal(tmpPath); // simulates a resume run
    expect(j2.has("k1")).toBe(true);
    expect(j2.get("k1")).toEqual({ result: { ok: true }, outputTokens: 42 });
  });

  it("starts fresh on a corrupt journal file", () => {
    writeFileSync(tmpPath, "not json{{{", "utf8");
    const j = new Journal(tmpPath);
    expect(j.has("anything")).toBe(false); // no throw, empty
  });
});
