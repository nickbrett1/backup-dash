// Debug surface only: the same cached status object `/` uses, as JSON.
// GET is the only export — see tests/no-write-path.test.js.
import { statusReader } from "$lib/status.js";

export async function GET() {
  try {
    const status = await statusReader().getStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    // Even the debug endpoint answers rather than 500ing.
    return new Response(
      JSON.stringify({
        verdict: "unknown",
        error: error instanceof Error ? error.message : String(error),
        as_of: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }
}
