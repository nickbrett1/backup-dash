// `/data/history.jsonl` — one line per run, keyed on `run_id`.
//
// `last_success.json` is overwritten nightly and holds no history, so the
// dashboard records its own. The idempotency rule is the point: the same
// `run_id` written twice must produce one line, because a restart, a double
// poll or two open browsers would otherwise silently double-count.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const FIELDS = [
  "run_id",
  "epoch",
  "repo_bytes",
  "snapshots",
  "containers",
  "pg_dumps",
  "sqlite_dumps",
  "duration_sec",
];

function normalize(entry) {
  const line = {};
  for (const field of FIELDS) line[field] = entry[field] ?? null;
  return line;
}

/** Read every parseable line. A truncated final line is skipped, not fatal. */
export function readHistory(file) {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") out.push(parsed);
    } catch {
      // A half-written line from a crash. Ignore it rather than refusing to
      // render the whole trend.
    }
  }
  return out;
}

export function latestEntry(entries) {
  return entries.length ? entries[entries.length - 1] : null;
}

/**
 * Append `entry` unless its `run_id` is already the newest line's.
 * Returns `{ appended, reason }`.
 */
export function appendHistory(file, entry) {
  if (!entry || !entry.run_id) return { appended: false, reason: "no run_id" };
  const entries = readHistory(file);
  const newest = latestEntry(entries);
  if (newest && newest.run_id === entry.run_id) {
    return { appended: false, reason: "duplicate run_id" };
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(normalize(entry))}\n`, "utf8");
  return { appended: true, reason: "new run" };
}

/** Build the in-memory trend the home page draws. */
export function trend(entries, limit = 60) {
  return entries
    .filter((e) => Number.isFinite(e.epoch))
    .slice(-limit)
    .map((e) => ({
      run_id: e.run_id,
      epoch: e.epoch,
      at: new Date(e.epoch * 1000).toISOString(),
      repo_bytes: Number.isFinite(e.repo_bytes) ? e.repo_bytes : null,
      duration_sec: Number.isFinite(e.duration_sec) ? e.duration_sec : null,
      snapshots: Number.isFinite(e.snapshots) ? e.snapshots : null,
    }));
}

export function growthPerRun(entries) {
  const withBytes = entries.filter((e) => Number.isFinite(e.repo_bytes));
  if (withBytes.length < 2) return null;
  const first = withBytes[0].repo_bytes;
  const last = withBytes[withBytes.length - 1].repo_bytes;
  return { delta: last - first, runs: withBytes.length - 1 };
}
