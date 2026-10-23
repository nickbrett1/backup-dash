// The single place restic is invoked.
//
// Three invariants live here and nowhere else:
//   1. every argv carries `--no-lock` — the dashboard must be invisible to
//      restic's lock protocol, or it can delay/block the 03:30 run;
//   2. the verb comes from a closed enum of read verbs (never a string from a
//      caller, never user input);
//   3. at most one restic process runs at a time.
//
// `tests/restic-argv.test.js` exercises all three.

import { execFile } from "node:child_process";
import { config } from "./config.js";

/** Closed verb allowlist. Nothing outside this object can be passed. */
export const ResticVerb = Object.freeze({
  SNAPSHOTS: "snapshots",
  STATS: "stats",
  VERSION: "version",
  CAT: "cat",
});

const ALLOWED = new Set(Object.values(ResticVerb));

/** Named so the test can assert on intent, not just the enum. */
export const MUTATING_VERBS = Object.freeze([
  "backup",
  "forget",
  "prune",
  "check",
  "unlock",
  "restore",
  "tag",
  "copy",
  "mount",
  "dump",
  "ls",
  "key",
  "migrate",
  "init",
  "rewrite",
]);

function assertVerb(verb) {
  if (!ALLOWED.has(verb)) {
    throw new Error(`restic verb "${verb}" is not in the read-only allowlist`);
  }
}

function sftpCommand(cfg) {
  return [
    "ssh",
    `-i ${cfg.resticSshKey}`,
    "-o IdentitiesOnly=yes",
    "-o BatchMode=yes",
    "-o StrictHostKeyChecking=yes",
    `-o UserKnownHostsFile=${cfg.knownHosts}`,
    "-s sftp",
  ].join(" ");
}

/**
 * Build the argv for a restic call. Pure, so the invariant is testable without
 * spawning anything.
 */
export function buildResticArgv(verb, args = [], cfg = config()) {
  return [
    "--repo",
    cfg.resticRepo,
    "--no-lock",
    "-o",
    `sftp.command=${sftpCommand(cfg)}`,
    verb,
    ...args,
  ];
}

// One process at a time, for the whole process. A refresh storm must not spawn
// ten concurrent scans of a 23 G repo on the box that just finished a backup.
let chain = Promise.resolve();

function withMutex(fn) {
  const run = chain.then(fn, fn);
  // Keep the chain alive regardless of this call's outcome.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function execRestic(argv, { timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    execFile(
      "restic",
      argv,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr
            ? `: ${stderr.trim().split("\n").slice(-3).join(" | ")}`
            : "";
          reject(
            new Error(
              `restic failed (${error.code ?? error.message})${detail}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Run one read-only restic command and return its stdout.
 * @param {keyof typeof ResticVerb} verbName
 */
export async function runRestic(verbName, args = [], overrides = {}) {
  const verb = ResticVerb[verbName];
  assertVerb(verb);
  const cfg = config();
  const argv = buildResticArgv(verb, args, cfg);
  const env = {
    ...process.env,
    // Passed through the environment, never argv: argv is logged, /proc is
    // world-readable, and this is the repo password.
    RESTIC_PASSWORD: cfg.resticPassword,
    ...(overrides.env ?? {}),
  };
  return withMutex(() =>
    execRestic(argv, {
      timeoutMs: overrides.timeoutMs ?? cfg.resticTimeoutMs,
      env,
    }),
  );
}

export async function listSnapshots() {
  return JSON.parse((await runRestic("SNAPSHOTS", ["--json"])) || "[]");
}

export async function repoStats() {
  // raw-data = bytes actually stored, which is what `repo_bytes` means. The
  // default mode reports restore-size, a different (larger) number.
  return JSON.parse(
    (await runRestic("STATS", ["--json", "--mode", "raw-data"])) || "{}",
  );
}

export async function resticVersion() {
  return (await runRestic("VERSION", ["--json"])).trim();
}
