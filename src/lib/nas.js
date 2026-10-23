// NAS share snapshots over SSH.
//
// The key this uses must be installed only *after* the `command=` wrapper is on
// the NAS (see the design note §4.5). Passwordless sudo is live on that box, so
// an unconstrained key is root. Nothing here can be widened by a caller: both
// commands are fixed strings built from validated share/snapshot names.

import { execFile } from "node:child_process";
import { config } from "./config.js";

const SNAPSHOT_RE =
  /^GMT([+-]\d{2})-(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/;

function sshArgs(cfg) {
  return [
    "-p",
    String(cfg.nasPort),
    "-i",
    cfg.nasSshKey,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${cfg.knownHosts}`,
    "-o",
    "ConnectTimeout=10",
    `${cfg.nasUser}@${cfg.nasHost}`,
  ];
}

function ssh(command, cfg = config()) {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      [...sshArgs(cfg), command],
      { timeout: cfg.nasTimeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`nas ssh failed: ${(stderr || error.message).trim()}`),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Parse `synosharesnapshot list` output.
 *
 * The first line is a header ("There has N snapshots of share [...]"), never a
 * snapshot. Names look like `GMT-04-2026.10.23-07.14.16`; the `GMT-04` is a NAS
 * artefact and is wrong half the year, so it is parsed but never used as the
 * true offset — the wall-clock time is interpreted in the dashboard's zone.
 *
 * @param {string} stdout
 * @param {{timeZone?: string}} [opts]
 */
export function parseSnapshotList(stdout, opts = {}) {
  const timeZone = opts.timeZone ?? config().timeZone;
  const snapshots = [];
  for (const rawLine of String(stdout).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = SNAPSHOT_RE.exec(line);
    if (!match) continue; // header, blank line, or something we do not understand
    const [, embeddedOffset, year, month, day, hour, minute, second] = match;
    snapshots.push({
      name: line,
      // Kept for diagnostics only. Never used for the instant.
      embedded_offset: embeddedOffset,
      local: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
      at: wallClockToIso({ year, month, day, hour, minute, second }, timeZone),
      at_ms: wallClockToMs(
        { year, month, day, hour, minute, second },
        timeZone,
      ),
    });
  }
  snapshots.sort((a, b) => a.at_ms - b.at_ms);
  return snapshots;
}

function wallClockParts({ year, month, day, hour, minute, second }) {
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

function wallClockToMs(parts, timeZone) {
  const p = wallClockParts(parts);
  const guess = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const offsetOf = (ms) => {
    const local = {};
    for (const { type, value } of fmt.formatToParts(new Date(ms))) {
      if (type !== "literal") local[type] = Number.parseInt(value, 10);
    }
    return (
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      ) - ms
    );
  };
  return guess - offsetOf(guess - offsetOf(guess));
}

function wallClockToIso(parts, timeZone) {
  return new Date(wallClockToMs(parts, timeZone)).toISOString();
}

export function isValidSnapshotName(name) {
  return typeof name === "string" && SNAPSHOT_RE.test(name);
}

/** Only validated names ever reach the shell. */
function assertSnapshot(name) {
  if (!isValidSnapshotName(name))
    throw new Error(`invalid snapshot name: ${name}`);
}

export async function listNasSnapshots(cfg = config()) {
  const stdout = await ssh(
    `sudo -n /usr/syno/sbin/synosharesnapshot list ${cfg.nasShare}`,
    cfg,
  );
  return parseSnapshotList(stdout, { timeZone: cfg.timeZone });
}

export async function snapshotSize(name, cfg = config()) {
  assertSnapshot(name);
  const stdout = await ssh(
    `sudo -n /usr/syno/sbin/synosharesnapshot snapsize ${cfg.nasShare} ${name}`,
    cfg,
  );
  return parseSnapsize(stdout);
}

/** `snapsize` prints a human size; take the bytes if present, else the text. */
export function parseSnapsize(stdout) {
  const text = String(stdout).trim();
  const bytes = /(\d+)\s*bytes?/i.exec(text) ?? /\b(\d{6,})\b/.exec(text);
  return { raw: text, bytes: bytes ? Number.parseInt(bytes[1], 10) : null };
}
