import { statusReader } from "$lib/status.js";

export async function load({ setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  try {
    return { status: await statusReader().getStatus() };
  } catch {
    // The tile is in an iframe on a wall. It renders a plain "unknown"
    // rather than an error page.
    return { status: null };
  }
}
