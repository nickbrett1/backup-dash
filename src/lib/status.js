// The cheap status object: state file + DAG + suspend flag + own history.
//
// This is all `/`, `/tile` and `/api/status` are allowed to read. restic and
// SSH must never appear on this path: those two surfaces are what is on a wall
// or a phone, and they have to answer instantly while the NAS is unreachable.

import { createCache } from "./cache.js";
import { config } from "./config.js";
import { readSchedule, readSuspend, resolveSchedule } from "./dag.js";
import { appendHistory, growthPerRun, readHistory, trend } from "./history.js";
import { formatAge, formatInZone, nextRun } from "./schedule.js";
import { readState, unknownState, UNKNOWN, verdict } from "./state.js";

let shared;

/** Lazy singleton so routes do not capture the environment at import time. */
export function statusReader() {
  if (!shared) shared = createStatusReader();
  return shared;
}

/** Tests only. */
export function resetStatusReader() {
  shared = undefined;
}

export function createStatusReader(cfg = config()) {
  const stateCache = createCache({
    name: "state",
    ttlMs: cfg.cacheTtlMs,
    loader: async () => readState(cfg.stateFile),
  });
  const scheduleCache = createCache({
    name: "schedule",
    ttlMs: cfg.cacheTtlMs,
    loader: async () => resolveSchedule(cfg.dagFile),
  });

  return {
    caches: { state: stateCache, schedule: scheduleCache },

    async getStatus(now = new Date()) {
      const [stateResult, scheduleResult] = await Promise.all([
        stateCache.get(),
        scheduleCache.get(),
      ]);

      const state =
        stateResult.value ?? unknownState("state source unavailable");
      const schedule = scheduleResult.value ?? {
        ok: false,
        cron: null,
        source: "env",
      };

      const suspend = readSuspend(cfg.suspendFile);

      let next = null;
      if (schedule.ok) {
        try {
          next = nextRun(schedule.cron, { from: now, timeZone: cfg.timeZone });
        } catch {
          next = null;
        }
      }

      // The deadline for "a night was missed" is the first scheduled run after
      // the last success, plus grace. Computed from the same cron so a schedule
      // change does not require editing a window constant.
      let nextRunAfterLast = null;
      if (schedule.ok && state.last_success_epoch) {
        try {
          nextRunAfterLast = nextRun(schedule.cron, {
            from: new Date(state.last_success_epoch * 1000),
            timeZone: cfg.timeZone,
          });
        } catch {
          nextRunAfterLast = null;
        }
      }

      const verdictState = verdict(state, {
        now,
        nextRun,
        nextRunAfterLast,
        suspended: suspend.suspended === true,
        graceMinutes: cfg.graceMinutes,
      });

      const entries = readHistory(cfg.historyPath);
      // Record this run once. Same run_id twice writes one line; a read-only
      // /data volume fails here without taking the page down.
      let appendNote = null;
      if (state.ok && state.run_id) {
        try {
          appendHistory(cfg.historyPath, {
            run_id: state.run_id,
            epoch: state.last_success_epoch,
            repo_bytes: state.repo_bytes,
            snapshots: state.snapshots,
            containers: state.containers,
            pg_dumps: state.pg_dumps,
            sqlite_dumps: state.sqlite_dumps,
            duration_sec: state.duration_sec,
          });
        } catch (error) {
          appendNote = `history not writable: ${error.code ?? error.message}`;
        }
      }
      const afterAppend = appendNote ? entries : readHistory(cfg.historyPath);

      const ageSeconds =
        state.last_success_epoch === null
          ? null
          : Math.max(
              0,
              Math.floor(now.getTime() / 1000 - state.last_success_epoch),
            );

      return {
        as_of: now.toISOString(),
        verdict: verdictState,
        unknown_reason: verdictState === UNKNOWN ? state.error : null,
        state,
        age_seconds: ageSeconds,
        age: formatAge(ageSeconds),
        next_run: next
          ? {
              iso: next.toISOString(),
              display: formatInZone(next, cfg.timeZone),
              in_seconds: Math.round((next.getTime() - now.getTime()) / 1000),
            }
          : null,
        schedule: {
          cron: schedule.cron,
          source: schedule.source,
          fallback: schedule.fallback ?? false,
        },
        suspend,
        history: {
          entries: afterAppend.length,
          trend: trend(afterAppend),
          growth: growthPerRun(afterAppend),
        },
        degraded: {
          state: stateResult.degraded,
          state_error: stateResult.error,
          schedule: scheduleResult.degraded,
          history: appendNote ? true : false,
          history_error: appendNote,
        },
      };
    },
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 100 || unit === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
}

export { readSchedule };
