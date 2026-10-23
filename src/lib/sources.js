// Lazily-built readers for the credentialed sources.
//
// Module-level caches so a refresh survives the request that warmed it. Each
// source is independent: restic being down does not stop the NAS panel, and
// neither stops the page.

import { createCache } from "./cache.js";
import { config } from "./config.js";
import { readContents, groupContents, readContainerNames } from "./contents.js";
import { listNasSnapshots, snapshotSize } from "./nas.js";
import { listSnapshots, repoStats, resticVersion } from "./restic.js";

let resticCache;
let snapshotListCache;
let nasCache;
let contentsCache;

/** One refresh does snapshots + stats + version; they are all one repo visit. */
export function getRestic() {
  if (!resticCache) {
    resticCache = createCache({
      name: "restic",
      ttlMs: config().cacheTtlMs,
      loader: async () => {
        const [snapshots, stats, version] = await Promise.all([
          listSnapshots(),
          repoStats(),
          resticVersion().catch(() => null),
        ]);
        return { snapshots, stats, version };
      },
    });
  }
  return resticCache.get();
}

/**
 * Snapshot times only — one cheap `snapshots --json`, no stats walk.
 *
 * The tile needs the recovery horizon (oldest snapshot) on every poll, and
 * `getRestic()` would drag the 20-second stats scan in with it. Separate cache,
 * separate process, same TTL rule.
 */
export function getSnapshotList() {
  if (!snapshotListCache) {
    snapshotListCache = createCache({
      name: "snapshot-list",
      ttlMs: config().cacheTtlMs,
      loader: async () => {
        const snapshots = await listSnapshots();
        const times = snapshots
          .map((snap) => snap.time)
          .filter(Boolean)
          .sort();
        return {
          count: snapshots.length,
          oldest: times[0] ?? null,
          newest: times.at(-1) ?? null,
        };
      },
    });
  }
  return snapshotListCache.get();
}

export function getNasSnapshots() {
  if (!nasCache) {
    nasCache = createCache({
      name: "nas",
      ttlMs: config().cacheTtlMs,
      loader: async () => {
        const snapshots = await listNasSnapshots();
        // `snapsize` is one SSH round-trip per snapshot. With the 512-snapshot
        // cap that is 512 round-trips per refresh, so only the newest few carry
        // a size; the rest render without one.
        const newest = snapshots.slice(-12);
        const sized = await Promise.all(
          newest.map(async (snap) => {
            try {
              return { ...snap, size: await snapshotSize(snap.name) };
            } catch {
              return { ...snap, size: null };
            }
          }),
        );
        const byName = new Map(sized.map((s) => [s.name, s]));
        return snapshots.map(
          (snap) => byName.get(snap.name) ?? { ...snap, size: null },
        );
      },
    });
  }
  return nasCache.get();
}

export function getContents() {
  if (!contentsCache) {
    contentsCache = createCache({
      name: "contents",
      ttlMs: config().cacheTtlMs,
      loader: async () => {
        const root = config().backupDir;
        const contents = readContents(root);
        return {
          ...contents,
          groups: groupContents(contents),
          containers: readContainerNames(root),
        };
      },
    });
  }
  return contentsCache.get();
}

/** Tests only. */
export function resetSourceCaches() {
  resticCache = undefined;
  snapshotListCache = undefined;
  nasCache = undefined;
  contentsCache = undefined;
}
