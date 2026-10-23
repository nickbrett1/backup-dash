import { getRestic } from "$lib/sources.js";
import { statusReader } from "$lib/status.js";

export async function load({ setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  const [status, restic] = await Promise.all([
    statusReader()
      .getStatus()
      .catch(() => null),
    getRestic(),
  ]);
  return { status, restic };
}
