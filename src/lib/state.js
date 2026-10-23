// Reads `last_success.json` and turns it into the verdict.
//
// The one thing this file must never do is turn "I cannot tell" into `0`.
// Absent files, malformed JSON and missing required fields all produce
// `unknown`; optional fields (the ones the pipeline does not write yet) stay
// `null` rather than becoming zero.

import { readFileSync } from "node:fs";

export const UNKNOWN = "unknown";

const REQUIRED_EPOCH_FIELDS = ["last_success_epoch", "last_success"];
const OPTIONAL_NUMBERS = [
  "snapshots",
  "containers",
  "pg_dumps",
  "sqlite_dumps",
  "repo_bytes",
  "duration_sec",
  "snapshot_retention_days",
];

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} file
 * @param {{now?: () => Date}} [opts]
 */
export function readState(file, opts = {}) {
  const now = opts.now ?? (() => new Date());
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    return unknownState(
      `state file unreadable: ${error.code ?? error.message}`,
      now(),
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return unknownState(`state file malformed: ${error.message}`, now());
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return unknownState("state file is not a JSON object", now());
  }

  let epoch = asNumber(parsed.last_success_epoch);
  const lastSuccess =
    typeof parsed.last_success === "string" ? parsed.last_success : null;
  if (epoch === null && lastSuccess) {
    const ms = Date.parse(lastSuccess);
    if (Number.isFinite(ms)) epoch = Math.floor(ms / 1000);
  }
  if (epoch === null) {
    return unknownState("state file has no usable last_success time", now());
  }
  if (!REQUIRED_EPOCH_FIELDS.some((f) => parsed[f] !== undefined)) {
    return unknownState("state file missing required fields", now());
  }

  const numbers = {};
  for (const key of OPTIONAL_NUMBERS) numbers[key] = asNumber(parsed[key]);

  return {
    ok: true,
    error: null,
    last_success: lastSuccess,
    last_success_epoch: epoch,
    run_id: typeof parsed.run_id === "string" ? parsed.run_id : null,
    repo: typeof parsed.repo === "string" ? parsed.repo : null,
    snapshots: numbers.snapshots,
    // Optional: the pipeline starts writing these with the next successful
    // run. Their absence is not an error and must not render as 0.
    containers: numbers.containers,
    pg_dumps: numbers.pg_dumps,
    sqlite_dumps: numbers.sqlite_dumps,
    repo_bytes: numbers.repo_bytes,
    duration_sec: numbers.duration_sec,
    snapshot_retention_days: numbers.snapshot_retention_days,
    read_at: now().toISOString(),
  };
}

export function unknownState(reason, at = new Date()) {
  return {
    ok: false,
    error: reason,
    last_success: null,
    last_success_epoch: null,
    run_id: null,
    repo: null,
    snapshots: null,
    containers: null,
    pg_dumps: null,
    sqlite_dumps: null,
    repo_bytes: null,
    duration_sec: null,
    snapshot_retention_days: null,
    read_at: at.toISOString(),
  };
}

/**
 * Four-state verdict. `unknown` beats everything: if the state cannot be read
 * we cannot honestly claim the backup is fine, stale or suspended.
 *
 * @param {ReturnType<typeof readState>} state
 * @param {{
 *   now: Date,
 *   nextRun: Date|null,
 *   suspended: boolean,
 *   graceMinutes?: number,
 * }} ctx
 */
export function verdict(state, ctx) {
  if (!state.ok) return UNKNOWN;
  if (ctx.suspended) return "suspended";

  const lastMs = state.last_success_epoch * 1000;
  // Deadline: the first scheduled run after the last success, plus grace.
  // Falling back to 24h + grace keeps the verdict meaningful when the DAG is
  // unreadable, which is exactly when nobody is watching the nail.
  const grace = (ctx.graceMinutes ?? 180) * 60_000;
  const deadline = ctx.nextRunAfterLast
    ? ctx.nextRunAfterLast.getTime() + grace
    : lastMs + 24 * 3_600_000 + grace;

  return ctx.now.getTime() <= deadline ? "ok" : "stale";
}
