import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCache } from "../src/lib/cache.js";
import { readContents, readContainerNames } from "../src/lib/contents.js";
import { createStatusReader } from "../src/lib/status.js";

let dir;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bd-degrade-"));
});

afterEach(() => {
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

function env(overrides) {
  Object.assign(process.env, overrides);
}

describe("cache: stale-while-error", () => {
  it("serves the last good value, flagged degraded, when the source throws", async () => {
    let fail = false;
    const cache = createCache({
      name: "flaky",
      ttlMs: 0,
      loader: async () => {
        if (fail) throw new Error("source down");
        return { answer: 42 };
      },
    });

    const first = await cache.get();
    expect(first.degraded).toBe(false);
    expect(first.value.answer).toBe(42);

    fail = true;
    const second = await cache.get();
    expect(second.degraded).toBe(true);
    expect(second.value.answer).toBe(42); // last good value survives
    expect(second.asOf).toBe(first.asOf);
    expect(second.error).toMatch(/source down/);
  });

  it("resolves rather than rejecting when there has never been a good value", async () => {
    const cache = createCache({
      name: "dead",
      ttlMs: 0,
      loader: async () => {
        throw new Error("nope");
      },
    });
    const result = await cache.get();
    expect(result.degraded).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it("is single-flight: concurrent callers share one load", async () => {
    let calls = 0;
    const cache = createCache({
      name: "slow",
      ttlMs: 0,
      loader: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 30));
        return calls;
      },
    });
    const results = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(calls).toBe(1);
    expect(results.every((r) => r.value === 1)).toBe(true);
  });
});

describe("status reader degrades instead of throwing", () => {
  it("reports unknown for a missing state file and still computes a next run", async () => {
    env({
      STATE_FILE: join(dir, "absent.json"),
      HISTORY_PATH: join(dir, "history.jsonl"),
      DAG_FILE: join(dir, "absent.yaml"),
      SUSPEND_FILE: join(dir, "absent-suspend"),
      NEXT_RUN_CRON: "30 3 * * *",
    });
    const reader = createStatusReader();
    const status = await reader.getStatus(new Date("2026-10-23T12:00:00Z"));

    expect(status.verdict).toBe("unknown");
    expect(status.unknown_reason).toMatch(/unreadable/);
    expect(status.state.repo_bytes).toBeNull(); // not 0
    expect(status.next_run?.iso).toBe("2026-10-24T07:30:00.000Z");
    expect(status.schedule.fallback).toBe(true);
  });

  it("survives an unreadable DAG by falling back to NEXT_RUN_CRON", async () => {
    writeFileSync(
      join(dir, "dag.yaml"),
      "name: um790-backup\nsteps:\n  - run: echo hi\n",
    );
    env({
      STATE_FILE: join(dir, "absent.json"),
      HISTORY_PATH: join(dir, "history.jsonl"),
      DAG_FILE: join(dir, "dag.yaml"),
      SUSPEND_FILE: join(dir, "no-suspend"),
      NEXT_RUN_CRON: "15 4 * * *",
    });
    const reader = createStatusReader();
    const status = await reader.getStatus(new Date("2026-10-23T12:00:00Z"));
    expect(status.schedule.cron).toBe("15 4 * * *");
    expect(status.schedule.source).toBe("env");
  });

  it("records a run once and keeps the trend", async () => {
    const stateFile = join(dir, "state.json");
    const historyPath = join(dir, "history.jsonl");
    writeFileSync(
      stateFile,
      JSON.stringify({
        last_success: "2026-10-23T11:14:00Z",
        last_success_epoch: 1792754040,
        run_id: "01JRUN",
        snapshots: 12,
        repo_bytes: 100,
        duration_sec: 800,
      }),
    );
    env({
      STATE_FILE: stateFile,
      HISTORY_PATH: historyPath,
      DAG_FILE: join(dir, "absent.yaml"),
      SUSPEND_FILE: join(dir, "no-suspend"),
      NEXT_RUN_CRON: "30 3 * * *",
    });

    const reader = createStatusReader();
    const first = await reader.getStatus(new Date("2026-10-23T12:00:00Z"));
    const second = await reader.getStatus(new Date("2026-10-23T12:00:30Z"));

    expect(first.history.entries).toBe(1);
    expect(second.history.entries).toBe(1); // same run_id, no double count
    expect(first.verdict).toBe("ok");
  });
});

describe("contents degrades", () => {
  it("returns an empty tree for an unreadable root", () => {
    const contents = readContents(join(dir, "absent"));
    expect(contents.files).toEqual([]);
    expect(contents.totalBytes).toBe(0);
  });
});

describe("container names", () => {
  it("reads the pipeline's own containers.txt manifest", () => {
    mkdirSync(join(dir, "staging", "config"), { recursive: true });
    writeFileSync(
      join(dir, "staging", "config", "containers.txt"),
      "litellm\nminiflux\n",
    );
    // The manifest counts 2 while the directory holds 3 entries; the manifest
    // wins, so the site cannot report a count the pipeline never walked.
    writeFileSync(join(dir, "staging", "config", "litellm.json"), "{}");
    writeFileSync(join(dir, "staging", "config", "miniflux.json"), "{}");

    const found = readContainerNames(dir);
    expect(found.dir).toBe("staging/config");
    expect(found.source).toBe("containers.txt");
    expect(found.names).toEqual(["litellm", "miniflux"]);
  });

  it("falls back to the JSON filenames when the manifest is missing", () => {
    mkdirSync(join(dir, "staging", "config"), { recursive: true });
    writeFileSync(join(dir, "staging", "config", "paperless.json"), "{}");
    writeFileSync(join(dir, "staging", "config", "immich.json"), "{}");
    writeFileSync(join(dir, "staging", "config", ".keep"), "");

    const found = readContainerNames(dir);
    expect(found.source).toBe("filenames");
    expect(found.names).toEqual(["immich", "paperless"]);
  });

  it("accepts a per-container directory layout too", () => {
    mkdirSync(join(dir, "config", "paperless"), { recursive: true });
    expect(readContainerNames(dir)).toEqual({
      dir: "config",
      source: "filenames",
      names: ["paperless"],
    });
  });

  it("prefers staging/config over the older config/ layout", () => {
    mkdirSync(join(dir, "staging", "config"), { recursive: true });
    writeFileSync(join(dir, "staging", "config", "containers.txt"), "new\n");
    mkdirSync(join(dir, "config", "old"), { recursive: true });
    expect(readContainerNames(dir).names).toEqual(["new"]);
  });

  it("reports no directory rather than inventing names", () => {
    expect(readContainerNames(join(dir, "absent"))).toEqual({
      dir: null,
      source: null,
      names: [],
    });
  });
});
