import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, verdict, UNKNOWN } from "../src/lib/state.js";

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bd-state-"));
  file = join(dir, "last_success.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const COMPLETE = {
  last_success: "2026-10-23T11:14:00Z",
  last_success_epoch: 1792754040,
  run_id: "01JRUN",
  repo: "sftp:restic@192.168.1.2:/restic-target/um790",
  snapshots: 12,
  repo_bytes: 24696070144,
  duration_sec: 817,
  snapshot_retention_days: 90,
};

function write(payload) {
  writeFileSync(
    file,
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );
}

describe("state reader", () => {
  it("reads a complete file", () => {
    write(COMPLETE);
    const state = readState(file);
    expect(state.ok).toBe(true);
    expect(state.run_id).toBe("01JRUN");
    expect(state.repo_bytes).toBe(24696070144);
  });

  it("treats the three not-yet-written fields as absent, not zero", () => {
    write(COMPLETE);
    const state = readState(file);
    expect(state.containers).toBeNull();
    expect(state.pg_dumps).toBeNull();
    expect(state.sqlite_dumps).toBeNull();
    // The distinction is the whole point: null renders "—", 0 renders "0 B".
    expect(state.containers).not.toBe(0);
  });

  it("derives the epoch from last_success when the epoch field is missing", () => {
    const rest = { ...COMPLETE };
    delete rest.last_success_epoch;
    write(rest);
    const state = readState(file);
    expect(state.ok).toBe(true);
    expect(state.last_success_epoch).toBe(
      Date.parse(COMPLETE.last_success) / 1000,
    );
  });

  it("returns unknown for a malformed file", () => {
    write("{ not json");
    const state = readState(file);
    expect(state.ok).toBe(false);
    expect(state.last_success_epoch).toBeNull();
  });

  it("returns unknown when the file is absent", () => {
    const state = readState(join(dir, "nope.json"));
    expect(state.ok).toBe(false);
    expect(state.error).toMatch(/unreadable/);
  });

  it("returns unknown when no timestamp can be established", () => {
    write({ run_id: "x", snapshots: 3 });
    expect(readState(file).ok).toBe(false);
  });

  it("does not treat a missing optional number as an error", () => {
    write({ last_success: "2026-10-23T11:14:00Z", snapshots: null });
    const state = readState(file);
    expect(state.ok).toBe(true);
    expect(state.snapshots).toBeNull();
  });
});

describe("verdict", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const nextRunAfterLast = new Date("2026-10-24T07:30:00Z");

  it("is unknown when the state is unreadable — never ok", () => {
    const state = readState(join(dir, "missing.json"));
    expect(
      verdict(state, { now, nextRun: nextRunAfterLast, suspended: false }),
    ).toBe(UNKNOWN);
  });

  it("is ok inside the window", () => {
    write(COMPLETE);
    const state = readState(file);
    expect(verdict(state, { now, nextRunAfterLast, suspended: false })).toBe(
      "ok",
    );
  });

  it("is stale once the next run plus grace has passed", () => {
    write(COMPLETE);
    const state = readState(file);
    const late = new Date("2026-10-24T12:00:00Z");
    expect(
      verdict(state, { now: late, nextRunAfterLast, suspended: false }),
    ).toBe("stale");
  });

  it("is suspended when the flag exists, even if the file is old", () => {
    write(COMPLETE);
    const state = readState(file);
    const late = new Date("2026-11-24T12:00:00Z");
    expect(
      verdict(state, { now: late, nextRunAfterLast, suspended: true }),
    ).toBe("suspended");
  });

  it("falls back to 24h + grace when there is no schedule", () => {
    write(COMPLETE);
    const state = readState(file);
    expect(
      verdict(state, {
        now: new Date("2026-10-24T09:00:00Z"),
        nextRunAfterLast: null,
      }),
    ).toBe("ok");
    expect(
      verdict(state, {
        now: new Date("2026-10-24T20:00:00Z"),
        nextRunAfterLast: null,
      }),
    ).toBe("stale");
  });
});
