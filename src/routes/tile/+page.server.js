import { config } from "$lib/config.js";
import { statusReader } from "$lib/status.js";
import { getContents } from "$lib/sources.js";

export async function load({ setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  const cfg = config();

  const [status, contents] = await Promise.all([
    statusReader()
      .getStatus()
      .catch(() => null),
    // The contents walk is a local readdir of the backup dir: no credentials
    // and no network. It is cached, so it costs nothing on the 60s tick, but
    // its failure must never take the tile down with it.
    getContents().catch(() => null),
  ]);

  return { status, contents, timeZone: cfg.timeZone };
}
