import { statusReader } from "$lib/status.js";

export async function load({ setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  try {
    return { status: await statusReader().getStatus(), loadError: null };
  } catch (error) {
    // Nothing on this page may 500 because a source misbehaved.
    return {
      status: null,
      loadError: error instanceof Error ? error.message : String(error),
    };
  }
}
