// One cache per data source: TTL, single-flight, stale-while-error.
//
// The rule that matters: `get()` never rejects. A source that is slow, down or
// throwing yields the last good value flagged `degraded`, or an empty result
// flagged the same way when there has never been a good value. Pages must not
// 500 because a source is unavailable.

export function createCache({
  name,
  ttlMs = 60_000,
  loader,
  now = () => Date.now(),
}) {
  let value;
  let asOf = null;
  let expiresAt = 0;
  let inFlight = null;

  function fresh() {
    return asOf !== null && now() < expiresAt;
  }

  async function run() {
    const startedAt = now();
    try {
      const result = await loader();
      value = result;
      asOf = new Date(startedAt).toISOString();
      expiresAt = now() + ttlMs;
      return { name, value, asOf, degraded: false, error: null };
    } catch (error) {
      // Stale-while-error: serve the last good value, and say so.
      return {
        name,
        value,
        asOf,
        degraded: true,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      inFlight = null;
    }
  }

  return {
    name,
    async get() {
      if (fresh()) return { name, value, asOf, degraded: false, error: null };
      // Single-flight: a second caller joins the in-flight promise rather than
      // spawning a second process. This is what keeps a refresh storm from
      // running ten concurrent scans of a 23 G repo.
      if (inFlight) return inFlight;
      inFlight = run();
      return inFlight;
    },
    peek() {
      return { name, value, asOf, degraded: false, error: null };
    },
    reset() {
      value = undefined;
      asOf = null;
      expiresAt = 0;
      inFlight = null;
    },
  };
}
