<script>
  import { formatBytes } from "$lib/status.js";

  let { data } = $props();
  const status = $derived(data.status);

  const TEXT = {
    ok: "Backed up",
    stale: "Missed a night",
    suspended: "Backup suspended",
    unknown: "State unknown",
  };

  // One meter: how much of the expected window has been used. At 100% the
  // next backup should already have run.
  const usedFraction = $derived.by(() => {
    if (!status?.state?.last_success_epoch || !status?.next_run?.in_seconds)
      return null;
    const windowSeconds = 24 * 3600 + 180 * 60;
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
        state file unreadable
      {:else}
        {formatBytes(status.state.repo_bytes) ?? "—"} · {status.state
          .snapshots ?? "—"} snapshots · next
        {status.next_run?.display ?? "unknown"}
      {/if}
    </div>
  {/if}
</div>
