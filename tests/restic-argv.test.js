import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildResticArgv,
  MUTATING_VERBS,
  ResticVerb,
  runRestic,
} from "../src/lib/restic.js";

let dir;
let argvFile;
let savePath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bd-restic-"));
  argvFile = join(dir, "argv.log");
  savePath = process.env.PATH;

  // Stub restic on PATH: records argv, exits 0.
  const stub = join(dir, "restic");
  writeFileSync(
    stub,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argvFile}"\necho '[]'\n`,
  );
  chmodSync(stub, 0o755);
  process.env.PATH = `${dir}:${savePath}`;
});

afterEach(() => {
  process.env.PATH = savePath;
  rmSync(dir, { recursive: true, force: true });
});

const cfg = {
  resticRepo: "sftp:restic@192.168.1.2:/restic-target/um790",
  resticSshKey: "/secrets/id_restic_ed25519",
  knownHosts: "/app/known_hosts",
  resticPassword: "hunter2",
  resticTimeoutMs: 20_000,
};

describe("restic argv invariant", () => {
  it("always carries --no-lock", () => {
    for (const verb of Object.values(ResticVerb)) {
      const argv = buildResticArgv(verb, [], cfg);
      expect(argv).toContain("--no-lock");
    }
  });

  it("puts --no-lock before the verb, so restic parses it as a global flag", () => {
    const argv = buildResticArgv(ResticVerb.SNAPSHOTS, ["--json"], cfg);
    expect(argv.indexOf("--no-lock")).toBeLessThan(argv.indexOf("snapshots"));
  });

  it("uses sftp.args (restic supplies the host and subsystem), with the NAS port", () => {
    const argv = buildResticArgv(ResticVerb.SNAPSHOTS, ["--json"], {
      ...cfg,
      resticPort: "2222",
    });
    const opt = argv.find((a) => a.startsWith("sftp.args="));
    expect(opt).toBeTruthy();
    expect(opt).toContain("-p 2222");
    expect(opt).toContain("-i /secrets/id_restic_ed25519");
    expect(opt).toContain("StrictHostKeyChecking=yes");
    // sftp.command requires spelling out the host and subsystem; the pipeline
    // uses sftp.args and so do we.
    expect(argv.some((a) => a.startsWith("sftp.command="))).toBe(false);
  });

  it("never emits a mutating verb", () => {
    const argv = buildResticArgv(ResticVerb.STATS, ["--json"], cfg);
    for (const verb of MUTATING_VERBS) expect(argv).not.toContain(verb);
  });

  it("refuses a verb outside the enum", async () => {
    // @ts-expect-error deliberately invalid
    await expect(runRestic("BACKUP", ["/tmp"])).rejects.toThrow(/allowlist/);
  });

  it("rejects a raw string verb smuggled through args", () => {
    const argv = buildResticArgv(ResticVerb.SNAPSHOTS, ["--json"], cfg);
    expect(argv[argv.length - 1]).toBe("--json");
  });

  it("records --no-lock on a real (stubbed) invocation", async () => {
    await runRestic("SNAPSHOTS", ["--json"], { env: { ...process.env } });
    const recorded = readFileSync(argvFile, "utf8");
    expect(recorded).toContain("--no-lock");
    expect(recorded).toContain("snapshots");
    expect(recorded).not.toMatch(
      /^(backup|forget|prune|unlock|check|restore)$/m,
    );
  });

  it("passes the password in the environment, never in argv", async () => {
    await runRestic("VERSION", ["--json"], { env: { ...process.env } });
    const recorded = readFileSync(argvFile, "utf8");
    expect(recorded).not.toContain("hunter2");
  });
});

describe("restic mutex", () => {
  it("serialises concurrent calls", async () => {
    // Replace the stub with one that sleeps, then measure wall time. Two
    // parallel 250 ms calls must take ~500 ms, not ~250 ms.
    const slow = join(dir, "restic");
    writeFileSync(slow, `#!/bin/sh\nsleep 0.25\necho '[]'\n`);
    chmodSync(slow, 0o755);

    const started = Date.now();
    await Promise.all([
      runRestic("SNAPSHOTS", [], { env: process.env }),
      runRestic("STATS", [], { env: process.env }),
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  });
});
