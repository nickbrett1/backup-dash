<script>
  import { formatBytes } from "$lib/status.js";
  import { formatDateInZone, formatInZoneCompact } from "$lib/schedule.js";

  let { data } = $props();
  const status = $derived(data.status);
  const contents = $derived(data.contents);

  const TEXT = {
    ok: "Backed up",
    stale: "Missed a night",
    suspended: "Backup suspended",
    unknown: "State unknown",
  };

  // Absolute time of the last successful run, in the dashboard's own zone
  // (TZ). It sits opposite the verdict; the relative age leads the line below.
  const lastSuccess = $derived(
    status?.state?.last_success
      ? formatInZoneCompact(new Date(status.state.last_success), data.timeZone)
      : null,
  );

  const repoBytes = $derived(formatBytes(status?.state?.repo_bytes));

  // How far back the repo can actually be restored from: the oldest snapshot,
  // not the retention policy. "90 days" is what the policy promises; this is
  // what exists. Measured against the status snapshot's own clock rather than
  // Date.now() so the server render and the client hydration agree.
  const recovery = $derived.by(() => {
    const oldest = data.recovery?.value?.oldest;
    if (!oldest) return null;
    const then = Date.parse(oldest);
    const now = Date.parse(status?.as_of ?? "");
    if (!Number.isFinite(then)) return null;
    const days = Number.isFinite(now)
      ? Math.max(0, Math.floor((now - then) / 86_400_000))
      : null;
    return { label: formatDateInZone(new Date(then), data.timeZone), days };
  });

  // The dumps the pipeline stages under $BACKUP_DIR. Only pg/sqlite are
  // counted here: the rest of that tree is restic's own config (exclude.txt,
  // cache, ssh keys), which would read as content when it is not.
  const dumps = $derived.by(() => {
    const groups = contents?.value?.groups;
    if (!groups) return null;
    const parts = [
      { n: groups.pg?.length ?? 0, label: "pg" },
      { n: groups.sqlite?.length ?? 0, label: "sqlite" },
    ].filter((g) => g.n > 0);
    return parts.length > 0 ? parts : null;
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
    /* The verdict's colour cue. A dot rather than a bar: it survives a 12px
       font and reads at a glance from across the room. */
    .dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      margin-right: 7px;
      background: var(--unknown);
      vertical-align: 1px;
    }
    .dot.ok {
      background: var(--ok);
      box-shadow: 0 0 6px color-mix(in srgb, var(--ok) 55%, transparent);
    }
    .dot.stale {
      background: var(--stale);
      box-shadow: 0 0 6px color-mix(in srgb, var(--stale) 55%, transparent);
    }
    .dot.suspended {
      background: var(--suspended);
      box-shadow: 0 0 6px color-mix(in srgb, var(--suspended) 55%, transparent);
    }
    .dot.unknown {
      background: var(--unknown);
    }
    .line .at {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 0 5px;
    }
    .meta .sep {
      opacity: 0.5;
    }
    /* An empty state is stated, never left blank: a gap reads as a bug. */
    .meta .none {
      opacity: 0.75;
      font-style: italic;
    }
  </style>
</svelte:head>

<div class="tile" data-verdict={status?.verdict ?? "unknown"}>
  {#if !status}
    <div class="line">
      <strong><span class="dot unknown"></span>State unknown</strong>
      <span class="at">backup-dash</span>
    </div>
    <div class="meta"><span>status unavailable</span></div>
    <div class="meta"><span>recovery window unknown</span></div>
  {:else}
    <div class="line">
      <strong>
        <span class="dot {status.verdict}"></span>{TEXT[status.verdict] ??
          status.verdict}
      </strong>
      <span class="at">
        {status.verdict === "unknown" ? "no state" : (lastSuccess ?? "—")}
      </span>
    </div>
    <div class="meta">
      {#if status.verdict === "unknown"}
        <span>state file unreadable</span>
      {:else}
        {#if status.age}
          <span>last {status.age} ago</span>
        {:else}
          <span>no successful run recorded</span>
        {/if}

        {#if repoBytes}
          <span class="sep">·</span>
          <span>{repoBytes} in repo</span>
        {/if}

        {#if recovery}
          <span class="sep">·</span>
          <span>
            recover to {recovery.label}{recovery.days !== null
              ? ` (${recovery.days}d)`
              : ""}
          </span>
        {:else}
          <span class="sep">·</span>
          <span class="none">recovery window unknown</span>
        {/if}
      {/if}
    </div>
    {#if status.verdict !== "unknown"}
      <div class="meta">
        <span>staged:</span>
        {#if dumps}
          {#each dumps as dump, i (dump.label)}
            {#if i > 0}<span class="sep">·</span>{/if}
            <span>{dump.n} {dump.label}</span>
          {/each}
        {:else if contents}
          <span class="none">none — pipeline dumps land here</span>
        {:else}
          <span class="none">unknown — backup dir unreadable</span>
        {/if}
      </div>
    {/if}
  {/if}
</div>
