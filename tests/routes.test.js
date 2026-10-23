import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetSourceCaches } from "../src/lib/sources.js";
import { resetStatusReader } from "../src/lib/status.js";
import { load as homeLoad } from "../src/routes/+page.server.js";
import { load as contentsLoad } from "../src/routes/contents/+page.server.js";
import { load as snapshotsLoad } from "../src/routes/snapshots/+page.server.js";
import { load as repoLoad } from "../src/routes/repo/+page.server.js";
import { load as tileLoad } from "../src/routes/tile/+page.server.js";
import { GET as statusGet } from "../src/routes/api/status/+server.js";

let dir;
const saved = { ...process.env };
const headers = { setHeaders: () => {} };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bd-routes-"));
  mkdirSync(join(dir, "backup", "config"), { recursive: true });
  mkdirSync(join(dir, "backup", "pg"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      last_success: "2026-10-23T11:14:00Z",
      last_success_epoch: 1792754040,
      run_id: "01JRUN",
      snapshots: 12,
      repo_bytes: 1024,
      duration_sec: 817,
    }),
  );
  writeFileSync(join(dir, "backup", "config", "app.yaml"), "a: 1\n");
  writeFileSync(join(dir, "backup", "pg", "app.dump"), "x".repeat(64));
  writeFileSync(join(dir, "dag.yaml"), 'schedule: "30 3 * * *"\n');
  writeFileSync(join(dir, "known_hosts"), "");

  Object.assign(process.env, {
    STATE_FILE: join(dir, "state.json"),
    BACKUP_DIR: join(dir, "backup"),
    HISTORY_PATH: join(dir, "data", "history.jsonl"),
    DAG_FILE: join(dir, "dag.yaml"),
    SUSPEND_FILE: join(dir, "no-suspend"),
    RESTIC_SSH_KEY: join(dir, "no-key"),
    NAS_SSH_KEY: join(dir, "no-key"),
    KNOWN_HOSTS: join(dir, "known_hosts"),
    NAS_HOST: "127.0.0.1",
    NAS_PORT: "1",
    RESTIC_REPO: "sftp:restic@127.0.0.1:/repo",
    RESTIC_PASSWORD: "not-a-real-password",
    CACHE_TTL_MS: "0",
    NAS_TIMEOUT_MS: "1500",
    RESTIC_TIMEOUT_MS: "1500",
  });
  resetSourceCaches();
  resetStatusReader();
});

afterEach(() => {
  process.env = { ...saved };
  resetSourceCaches();
  resetStatusReader();
  rmSync(dir, { recursive: true, force: true });
});

describe("route loads never 500", () => {
  it("home returns a status object", async () => {
    const data = await homeLoad(headers);
    expect(data.status.verdict).toBe("ok");
    expect(data.loadError).toBeNull();
  });

  it("tile returns the cheap status plus the contents summary", async () => {
    const data = await tileLoad(headers);
    expect(data.status.state.snapshots).toBe(12);
    expect(data.contents.value.groups.pg).toHaveLength(1);
    expect(data.contents.value.groups.config).toHaveLength(1);
    // The tile names the recovery horizon; with restic unreachable in this
    // fixture it degrades instead of throwing.
    expect(data.recovery.degraded).toBe(true);
  });

  it("contents groups the tree and reports an unreadable staging dir quietly", async () => {
    const data = await contentsLoad(headers);
    expect(data.contents.value.files.length).toBeGreaterThanOrEqual(2);
    expect(data.contents.value.groups.pg).toHaveLength(1);
  });

  it("repo degrades when restic cannot run", async () => {
    const data = await repoLoad(headers);
    expect(data.restic.degraded).toBe(true);
    expect(data.restic.error).toBeTruthy();
    expect(data.status).not.toBeNull();
  });

  it("snapshots degrades when the NAS is unreachable", async () => {
    const data = await snapshotsLoad(headers);
    expect(data.nas.degraded).toBe(true);
    expect(data.share).toBe("restic-target");
    // The retention cap is still rendered, so the panel is not blank.
    expect(data.maxSnapshots).toBe(512);
  });

  it("api/status answers 200 JSON even with no state file", async () => {
    process.env.STATE_FILE = join(dir, "absent.json");
    const res = await statusGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).verdict).toBe("unknown");
  });
});
