import { config } from "$lib/config.js";
import { statusReader } from "$lib/status.js";
import { getNasSnapshots } from "$lib/sources.js";

const MAX_SNAPSHOTS = 512;

export async function load({ setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  const [status, nas] = await Promise.all([
    statusReader()
      .getStatus()
      .catch(() => null),
    getNasSnapshots(),
  ]);
  return { status, nas, maxSnapshots: MAX_SNAPSHOTS, share: config().nasShare };
}
