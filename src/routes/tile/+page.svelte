<script>
  import { formatBytes } from "$lib/status.js";
  import { formatInZoneCompact } from "$lib/schedule.js";

  let { data } = $props();
  const status = $derived(data.status);
  const contents = $derived(data.contents);
  const graceMinutes = $derived(data.graceMinutes ?? 180);

  const TEXT = {
    ok: "Backed up",
    stale: "Missed a night",
    suspended: "Backup suspended",
    unknown: "State unknown",
  };

  // Absolute time of the last successful run, in the dashboard's own zone
  // (TZ). The relative age is on the first line; this is the exact instant.
  const lastSuccess = $derived(
    status?.state?.last_success
      ? formatInZoneCompact(new Date(status.state.last_success), data.timeZone)
      : null,
  );

  const snapshots = $derived(
    Number.isFinite(status?.state?.snapshots) ? status.state.snapshots : null,
  );
  const repoBytes = $derived(formatBytes(status?.state?.repo_bytes));

  // The dumps the pipeline stages under $BACKUP_DIR. Only pg/sqlite are
  // counted here: the rest of that tree is restic's own config (exclude.txt,
  // cache, ssh keys), which would read as content when it is not. Omitted
  // entirely when the walk is unavailable or has nothing staged.
  const dumps = $derived.by(() => {
    const groups = contents?.value?.groups;
    if (!groups) return null;
    const parts = [
      { n: groups.pg?.length ?? 0, label: "pg" },
      { n: groups.sqlite?.length ?? 0, label: "sqlite" },
    ].filter((g) => g.n > 0);
    return parts.length > 0 ? parts : null;
  });

  // One meter: how much of the expected window has been used. At 100% the
  // next backup should already have run. The grace comes from the same
  // GRACE_MINUTES the verdict uses, so the bar and the verdict cannot drift.
  const usedFraction = $derived.by(() => {
    if (!status?.state?.last_success_epoch || !status?.next_run?.in_seconds)
      return null;
    const windowSeconds = 24 * 3600 + graceMinutes * 60;
    const frac = status.age_seconds / windowSeconds;
    return Math.min(1, Math.max(0, frac));
  });
</script>

<svelte:head>
  <title>backup-dash — tile</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :global(body) {
      background: transparent;
    }
    .tile {
      padding: 12px 14px;
      border-radius: 10px;
      background: var(--panel);
      border: 1px solid var(--line);
      font-size: 14px;
    }
    .line {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }
    .line strong {
      font-size: 15px;
    }
    .line .age {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .meter > span.stale {
      background: var(--stale);
    }
    .meter > span.unknown {
      background: var(--unknown);
    }
    .meter > span.suspended {
      background: var(--suspended);
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 0 5px;
    }
    .meta .at {
      color: var(--text);
    }
    .meta .sep {
      opacity: 0.5;
    }
  </style>
</svelte:head>

<div class="tile" data-verdict={status?.verdict ?? "unknown"}>
  {#if !status}
    <div class="line">
      <strong>State unknown</strong>
      <span class="age">backup-dash</span>
    </div>
    <div class="meter"><span class="unknown" style="width:100%"></span></div>
  {:else}
    <div class="line">
      <strong>{TEXT[status.verdict] ?? status.verdict}</strong>
      <span class="age">
        {status.verdict === "unknown"
          ? "no state"
          : `last ${status.age ?? "—"} ago`}
      </span>
    </div>
    <div class="meter">
      <span
        class={status.verdict}
        style={`width:${usedFraction === null ? 100 : (usedFraction * 100).toFixed(1)}%`}
      ></span>
    </div>
    <div class="meta">
      {#if status.verdict === "unknown"}
        <span>state file unreadable</span>
      {:else}
        {#if lastSuccess}
          <span class="at">
            {status.verdict === "ok" ? "taken" : "last success"}
            {lastSuccess}
          </span>
        {:else}
          <span class="at">no successful run recorded</span>
        {/if}

        {#if snapshots !== null}
          <span class="sep">·</span>
          <span>
            {snapshots} snapshot{snapshots === 1 ? "" : "s"}
          </span>
        {/if}

        {#if repoBytes}
          <span class="sep">·</span>
          <span>{repoBytes} in repo</span>
        {/if}
      {/if}
    </div>
    {#if status.verdict !== "unknown" && dumps}
      <div class="meta">
        <span>staged:</span>
        {#each dumps as dump, i (dump.label)}
          {#if i > 0}<span class="sep">·</span>{/if}
          <span>{dump.n} {dump.label}</span>
        {/each}
      </div>
    {/if}
  {/if}
</div>
