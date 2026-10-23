import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistory,
  growthPerRun,
  readHistory,
  trend,
} from "../src/lib/history.js";

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bd-history-"));
  file = join(dir, "data", "history.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry = {
  run_id: "01JRUN",
  epoch: 1761218040,
  repo_bytes: 1000,
  snapshots: 12,
  containers: 63,
  pg_dumps: 4,
  sqlite_dumps: 9,
  duration_sec: 817,
};

describe("history idempotency", () => {
  it("appends the first run", () => {
    expect(appendHistory(file, entry).appended).toBe(true);
    expect(readHistory(file)).toHaveLength(1);
  });

  it("writes one line when the same run_id is appended twice", () => {
    appendHistory(file, entry);
    const second = appendHistory(file, entry);
    expect(second.appended).toBe(false);
    expect(second.reason).toBe("duplicate run_id");
    expect(readHistory(file)).toHaveLength(1);
  });

  it("appends a different run_id", () => {
    appendHistory(file, entry);
    appendHistory(file, {
      ...entry,
      run_id: "01JNEXT",
      epoch: entry.epoch + 86400,
    });
    expect(readHistory(file)).toHaveLength(2);
  });

  it("ignores a truncated final line rather than losing the file", () => {
    appendHistory(file, entry);
    writeFileSync(file, `${readFileSync(file, "utf8")}{"run_id":"half`); // simulated crash
    expect(readHistory(file)).toHaveLength(1);
  });

  it("keeps absent optional fields null, not zero", () => {
    appendHistory(file, { run_id: "only", epoch: 1, repo_bytes: null });
    const [line] = readHistory(file);
    expect(line.containers).toBeNull();
    expect(line.pg_dumps).toBeNull();
  });

  it("reports growth between the first and last run", () => {
    appendHistory(file, entry);
    appendHistory(file, { ...entry, run_id: "b", epoch: 2, repo_bytes: 1500 });
    expect(growthPerRun(readHistory(file))).toEqual({ delta: 500, runs: 1 });
  });

  it("builds a trend", () => {
    appendHistory(file, entry);
    appendHistory(file, { ...entry, run_id: "b", epoch: 2, repo_bytes: 1500 });
    expect(trend(readHistory(file))).toHaveLength(2);
  });
});
