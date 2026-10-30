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
  // Chart geometry is shared by both trend cards: same viewBox, same padding,
  // so the two charts line up when they sit side by side.
  const CHART = { w: 640, h: 140, pad: 6 };

  /**
   * Turn a list of run points into polyline coordinates plus the inverse
   * mapping, so a reference line (the median) can be drawn on the same scale.
   * Returns null below two points: one point is not a trend.
   */
  function seriesFor(runs, valueOf) {
    const values = runs.map(valueOf);
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const yOf = (value) =>
      CHART.h - ((value - min) / span) * (CHART.h - CHART.pad * 2) - CHART.pad;
    const points = values.map((value, i) => ({
      x: (i / (values.length - 1)) * CHART.w,
      y: yOf(value),
    }));
    return {
      min,
      max,
      yOf,
      polyline: points
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" "),
    };
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** "42m", "1h 07m", "8s" — a backup duration never needs sub-second detail. */
  function fmtDuration(sec) {
    if (!Number.isFinite(sec)) return "—";
    const total = Math.round(sec);
    const hours = Math.floor(total / 3600);
    let minutes = Math.round((total % 3600) / 60);
    if (minutes === 60) {
      minutes = 0;
      return fmtDuration((hours + 1) * 3600);
    }
    if (hours && minutes)
      return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    if (hours) return `${hours}h`;
    if (!minutes) return `${total}s`;
    return `${minutes}m`;
  }

  const sizeRuns = $derived(trend.filter((p) => Number.isFinite(p.repo_bytes)));
  const sizeSeries = $derived(seriesFor(sizeRuns, (p) => p.repo_bytes));

  const durationRuns = $derived(
    trend.filter((p) => Number.isFinite(p.duration_sec)),
  );
  const durationSeries = $derived(
    seriesFor(durationRuns, (p) => p.duration_sec),
  );
  const medianDuration = $derived(
    median(durationRuns.map((p) => p.duration_sec)),
  );
</script>

{#snippet trendChart(series, { label, color, fillId, reference = null })}
  <svg
    viewBox="0 0 640 140"
    width="100%"
    height="150"
    role="img"
    aria-label={label}
  >
    <title>{label}</title>
    <defs>
      <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity="0.35" />
        <stop offset="100%" stop-color={color} stop-opacity="0" />
      </linearGradient>
    </defs>
    <polygon
      points={`0,140 ${series.polyline} 640,140`}
      fill="url(#{fillId})"
    />
    <!-- After the fill, so the reference line stays visible over it. -->
    {#if reference !== null}
      <line
        x1="0"
        y1={series.yOf(reference)}
        x2="640"
        y2={series.yOf(reference)}
        stroke="var(--muted)"
        stroke-width="1"
        stroke-dasharray="4 4"
        opacity="0.8"
      />
    {/if}
    <polyline
      points={series.polyline}
      fill="none"
      stroke={color}
      stroke-width="2"
    />
  </svg>
{/snippet}

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
          ? fmtDuration(status.state.duration_sec)
          : "—"}
      </div>
      <div class="foot">
        <span>the whole run, preflight → status</span
        >{#if prevDuration !== null}<span>
            · previous {fmtDuration(prevDuration)}</span
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

  <div class="charts">
    <div class="card" class:degraded={status.degraded.state}>
      <h2>Size trend</h2>
      {#if status.degraded.state}
        <div class="degraded-tag">degraded · {status.degraded.state_error}</div>
      {/if}
      {#if sizeSeries}
        {@render trendChart(sizeSeries, {
          label: "repo size per run",
          color: "var(--ok)",
          fillId: "size-fill",
        })}
        <div class="foot">
          {trend.length} recorded runs · oldest {formatBytes(
            trend[0]?.repo_bytes,
          )}
        </div>
      {:else}
        <p class="empty">
          History starts the day this deploys; the trend appears after the
          second recorded run ({status.history.entries} so far).
        </p>
      {/if}
    </div>

    <div class="card" class:degraded={status.degraded.state}>
      <h2>Duration trend</h2>
      {#if status.degraded.state}
        <div class="degraded-tag">degraded · {status.degraded.state_error}</div>
      {/if}
      {#if durationSeries}
        {@render trendChart(durationSeries, {
          label: "backup duration per run",
          color: "var(--suspended)",
          fillId: "duration-fill",
          reference: medianDuration,
        })}
        <div class="foot">
          {durationRuns.length} runs · median {fmtDuration(medianDuration)} · fastest
          {fmtDuration(durationSeries.min)} · slowest {fmtDuration(
            durationSeries.max,
          )}
        </div>
        <div class="foot muted">
          dashed line is the median; a climbing line is the run taking longer
        </div>
      {:else}
        <p class="empty">
          A duration trend needs two recorded runs; {durationRuns.length} so far.
        </p>
      {/if}
    </div>
  </div>
{/if}
