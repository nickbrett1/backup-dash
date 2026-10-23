// DAG file reads: the schedule line and the suspend flag.
//
// Both are cheap file reads. Both have a silent-wrong-answer failure mode, so
// both return *why* they could not answer rather than a default that looks
// healthy.

import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

/** Read `schedule:` from the DAG with a targeted regex, not a YAML dependency. */
export function readSchedule(dagFile = config().dagFile) {
  try {
    const raw = readFileSync(dagFile, "utf8");
    const match = /^\s*schedule:\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/m.exec(
      raw,
    );
    if (!match)
      return {
        ok: false,
        cron: null,
        source: "dag",
        note: "no schedule: line",
      };
    return { ok: true, cron: match[1].trim(), source: "dag", note: null };
  } catch (error) {
    return {
      ok: false,
      cron: null,
      source: "dag",
      note: `DAG unreadable: ${error.code ?? error.message}`,
    };
  }
}

/** Schedule with the NEXT_RUN_CRON fallback applied. */
export function resolveSchedule(dagFile) {
  const cfg = config();
  const fromDag = readSchedule(dagFile ?? cfg.dagFile);
  if (fromDag.ok) return { ...fromDag, fallback: false };
  return {
    ok: true,
    cron: cfg.nextRunCron,
    source: "env",
    fallback: true,
    note: fromDag.note,
  };
}

/**
 * Suspend flag.
 *
 * `…/dagu/data/suspend` is `drwxr-x--- root:root` on the host. A container that
 * cannot traverse it will report "not suspended" forever — a silent wrong
 * answer. So a permission error is reported as *unreadable*, not as `false`.
 */
export function readSuspend(suspendFile = config().suspendFile) {
  try {
    statSync(suspendFile);
    return { suspended: true, readable: true, note: null };
  } catch (error) {
    if (error.code === "ENOENT") {
      // Absent flag is only meaningful if we can see the directory it lives in.
      try {
        accessSync(dirname(suspendFile), constants.R_OK | constants.X_OK);
        return { suspended: false, readable: true, note: null };
      } catch (dirError) {
        return {
          suspended: null,
          readable: false,
          note: `suspend dir not traversable (${dirError.code}); cannot tell whether the backup is suspended`,
        };
      }
    }
    if (error.code === "EACCES" || error.code === "EPERM") {
      return {
        suspended: null,
        readable: false,
        note: `suspend flag not reachable (${error.code}); cannot tell whether the backup is suspended`,
      };
    }
    return {
      suspended: null,
      readable: false,
      note: `suspend check failed: ${error.code ?? error.message}`,
    };
  }
}

export function suspendExists(suspendFile = config().suspendFile) {
  return existsSync(suspendFile);
}
