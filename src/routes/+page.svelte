<script>
  import { formatBytes } from "$lib/status.js";

  let { data } = $props();
  const status = $derived(data.status);

  const VERDICT_TEXT = {
    ok: "Backup healthy",
    stale: "A night was missed",
    suspended: "Backup suspended",
    unknown: "Cannot read state",
  };

  function num(value) {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
  }

  const trend = $derived(status?.history?.trend ?? []);

  // The previous run's total duration, so the Duration card can say whether
  // this one was quick or slow. Excludes the current run by id, because the
  // newest history point is usually this very run.
  const prevDuration = $derived.by(() => {
    const s = status?.state;
    if (!Number.isFinite(s?.duration_sec)) return null;
    const earlier = trend.filter(
      (p) => Number.isFinite(p.duration_sec) && p.run_id !== s.run_id,
    );
    return earlier.length ? earlier.at(-1).duration_sec : null;
  });
  const points = $derived.by(() => {
    const values = trend.filter((p) => Number.isFinite(p.repo_bytes));
    if (values.length < 2) return [];
    const w = 640;
    const h = 140;
    const bytes = values.map((p) => p.repo_bytes);
    const min = Math.min(...bytes);
    const max = Math.max(...bytes);
    const span = max - min || 1;
    return values.map((p, i) => ({
      x: (i / (values.length - 1)) * w,
      y: h - ((p.repo_bytes - min) / span) * (h - 12) - 6,
      p,
    }));
  });
  const polyline = $derived(
    points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
  );
</script>

<svelte:head><title>backup-dash — overview</title></svelte:head>

{#if !status}
  <div class="card degraded">
    <h2>Status</h2>
    <p class="empty">The status reader failed: {data.loadError}</p>
  </div>
{:else}
  <div class="strip">
    <span class="badge {status.verdict}"
      >{VERDICT_TEXT[status.verdict] ?? status.verdict}</span
    >
    {#if status.verdict === "unknown"}
      <span class="hint"
        >{status.unknown_reason ?? "state file not readable"}</span
      >
    {:else}
      <span class="hint">
        Last success {status.age ?? "—"} ago{#if status.state.last_success}
          ({status.state.last_success}){/if}
      </span>
    {/if}
    {#if status.suspend.suspended === true}
      <span class="badge suspended">suspended</span>
    {:else if status.suspend.readable === false}
      <span class="hint degraded-tag">{status.suspend.note}</span>
    {/if}
  </div>

  <div class="grid">
    <div class="card">
      <h2>Last success</h2>
      <div class="value">{status.age ?? "—"}</div>
      <div class="foot">
        {status.state.last_success
          ? status.state.last_success
          : "no readable timestamp"}
      </div>
    </div>
    <div class="card">
      <h2>Repo size</h2>
      <div class="value">{formatBytes(status.state.repo_bytes) ?? "—"}</div>
      <div class="foot">
        {#if status.history.growth}
          {status.history.growth.delta >= 0 ? "+" : ""}{formatBytes(
            Math.abs(status.history.growth.delta),
          )} over {status.history.growth.runs} runs
        {:else}
          no history yet
        {/if}
      </div>
    </div>
    <div class="card">
      <h2>Snapshots</h2>
      <div class="value">{num(status.state.snapshots)}</div>
      <div class="foot">
        retention {num(status.state.snapshot_retention_days)} days{#if status.state.run_id}
          · {status.state.run_id.slice(0, 10)}{/if}
      </div>
    </div>
    <div class="card">
      <h2>Duration</h2>
      <div class="value">
        {Number.isFinite(status.state.duration_sec)
          ? `${Math.round(status.state.duration_sec / 60)}m`
          : "—"}
      </div>
      <div class="foot">
        <span>the whole run, preflight → status</span
        >{#if prevDuration !== null}<span>
            · previous {Math.round(prevDuration / 60)}m</span
          >{/if}
      </div>
    </div>
    <div class="card">
      <h2>Contents</h2>
      <div class="value">
        {Number.isFinite(status.state.containers)
          ? num(status.state.containers)
          : "—"}
      </div>
      <div class="foot">
        {#if Number.isFinite(status.state.containers)}
          <span>containers walked</span>
          {#if Number.isFinite(status.state.pg_dumps) || Number.isFinite(status.state.sqlite_dumps)}
            <span>
              · {num(status.state.pg_dumps)} pg / {num(
                status.state.sqlite_dumps,
              )}
              sqlite dumps</span
            >
          {/if}
        {:else}
          <span>contents not reported by the pipeline yet</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h2>Next run</h2>
    <div class="value" style="font-size:20px">
      {status.next_run?.display ?? "unknown"}
    </div>
    <div class="foot">
      <code class="mono">{status.schedule.cron ?? "—"}</code>
      {#if status.schedule.fallback}
        · falling back to <code class="mono">NEXT_RUN_CRON</code> (DAG unavailable)
      {/if}
    </div>
  </div>

  <div class="card" class:degraded={status.degraded.state}>
    <h2>Size trend</h2>
    {#if status.degraded.state}
      <div class="degraded-tag">degraded · {status.degraded.state_error}</div>
    {/if}
    {#if points.length >= 2}
      <svg
        viewBox="0 0 640 140"
        width="100%"
        height="150"
        role="img"
        aria-label="repo size per run"
      >
        <title>Repo size per run</title>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3fb950" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#3fb950" stop-opacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,140 ${polyline} 640,140`} fill="url(#fill)" />
        <polyline
          points={polyline}
          fill="none"
          stroke="#3fb950"
          stroke-width="2"
        />
      </svg>
      <div class="foot">
        {trend.length} recorded runs · oldest {formatBytes(
          trend[0]?.repo_bytes,
        )}
      </div>
    {:else}
      <p class="empty">
        History starts the day this deploys; the trend appears after the second
        recorded run ({status.history.entries} so far).
      </p>
    {/if}
  </div>
{/if}
