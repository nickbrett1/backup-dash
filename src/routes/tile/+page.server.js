import { config } from "$lib/config.js";
import { statusReader } from "$lib/status.js";
import { getSnapshotList } from "$lib/sources.js";

export async function load({ setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  const cfg = config();

  const [status, recovery] = await Promise.all([
    statusReader()
      .getStatus()
      .catch(() => null),
    // The recovery horizon: the oldest snapshot in the repo. Times only, so
    // this is one cheap `snapshots --json` per TTL, not the stats walk.
    getSnapshotList().catch(() => null),
  ]);

  return { status, recovery, timeZone: cfg.timeZone };
}
