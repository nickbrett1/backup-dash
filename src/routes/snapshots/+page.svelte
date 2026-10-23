<script>
  import { formatBytes } from "$lib/status.js";

  let { data } = $props();
  const status = $derived(data.status);
  const nas = $derived(data.nas);
  const snapshots = $derived(nas.value ?? []);
  const used = $derived(snapshots.length);
  const cap = $derived(data.maxSnapshots);
  const oldest = $derived(snapshots[0] ?? null);
  const newest = $derived(snapshots[snapshots.length - 1] ?? null);

  function display(iso) {
    if (!iso) return "—";
    return iso.slice(0, 16).replace("T", " ") + "Z";
  }
</script>

<svelte:head><title>backup-dash — NAS snapshots</title></svelte:head>

<h1>NAS snapshots</h1>
<p class="sub">
  Share <code class="mono">{data.share}</code> via
  <code class="mono">synosharesnapshot</code>. Wall-clock times are rendered in
  <code class="mono">America/New_York</code>; the
  <code class="mono">GMT-04</code> prefix in the snapshot name is a NAS artefact and
  is deliberately ignored.
</p>

{#if nas.degraded && !snapshots.length}
  <div class="card degraded">
    <h2>NAS unreachable</h2>
    <p class="empty">{nas.error}</p>
  </div>
{:else}
  <div class="grid">
    <div class="card" class:degraded={nas.degraded}>
      <h2>Snapshots held</h2>
      <div class="value">{used} / {cap}</div>
      <div class="meter">
        <span
          style={`width:${((used / cap) * 100).toFixed(1)}%;background:${used / cap > 0.9 ? "var(--stale)" : "var(--ok)"}`}
        ></span>
      </div>
      <div class="foot">
        {#if nas.degraded}
          <span class="degraded-tag">degraded</span> · as of {nas.asOf ??
            "never"}
        {:else}
          retention window {status?.state?.snapshot_retention_days ?? "—"} days
        {/if}
      </div>
    </div>
    <div class="card">
      <h2>Oldest</h2>
      <div class="value" style="font-size:18px">{display(oldest?.at)}</div>
      <div class="foot mono">{oldest?.name ?? "—"}</div>
    </div>
    <div class="card">
      <h2>Newest</h2>
      <div class="value" style="font-size:18px">{display(newest?.at)}</div>
      <div class="foot mono">{newest?.name ?? "—"}</div>
    </div>
  </div>

  <div class="card">
    <h2>Snapshot list</h2>
    {#if snapshots.length === 0}
      <p class="empty">No snapshots returned.</p>
    {:else}
      <table>
        <thead>
          <tr
            ><th>Name</th><th>Local wall clock</th><th class="num">Size</th></tr
          >
        </thead>
        <tbody>
          {#each [...snapshots].reverse() as snap (snap.name)}
            <tr>
              <td class="mono">{snap.name}</td>
              <td>{display(snap.at)}</td>
              <td class="num">{formatBytes(snap.size?.bytes) ?? "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="foot muted" style="margin-top:10px">
        Sizes are fetched for the newest 12 only; each one is an SSH round-trip
        and the cap is
        {cap}.
      </p>
    {/if}
  </div>
{/if}
