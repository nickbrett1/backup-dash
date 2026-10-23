import { statusReader } from "$lib/status.js";
import { getContents } from "$lib/sources.js";

export async function load({ setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  const [status, contents] = await Promise.all([
    statusReader()
      .getStatus()
      .catch(() => null),
    getContents(),
  ]);
  return { status, contents };
}
