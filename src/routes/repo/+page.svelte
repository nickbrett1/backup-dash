<script>
  import { formatBytes } from "$lib/status.js";

  let { data } = $props();
  const restic = $derived(data.restic);
  const snapshots = $derived(restic.value?.snapshots ?? []);
  const stats = $derived(restic.value?.stats ?? null);
  const stateRepoBytes = $derived(data.status?.state?.repo_bytes ?? null);
  const statsBytes = $derived(
    Number.isFinite(stats?.total_size)
      ? stats.total_size
      : Number.isFinite(stats?.total_bytes)
        ? stats.total_bytes
        : null,
  );
  // The cross-check is the point of this panel: two independent readings of
  // "how big is the repo", and the drift between them.
  const drift = $derived(
    statsBytes !== null && Number.isFinite(stateRepoBytes)
      ? statsBytes - stateRepoBytes
      : null,
  );

  function when(iso) {
    return iso ? iso.slice(0, 16).replace("T", " ") + "Z" : "—";
  }
</script>

<svelte:head><title>backup-dash — restic repo</title></svelte:head>

<h1>Restic repo</h1>
<p class="sub">
  Read-only view over <code class="mono"
    >{data.status?.state?.repo ??
      "sftp:restic@192.168.1.2:/restic-target/um790"}</code
  >. Every invocation carries <code class="mono">--no-lock</code>; the dashboard
  has no verb that can mutate the repo.
</p>

<div class="grid">
  <div class="card" class:degraded={restic.degraded}>
    <h2>Snapshots in repo</h2>
    <div class="value">
      {restic.degraded && !snapshots.length ? "—" : snapshots.length}
    </div>
    <div class="foot">
      {#if restic.degraded}
        <span class="degraded-tag">degraded</span> · {restic.error}
      {:else}
        as of {restic.asOf}
      {/if}
    </div>
  </div>
  <div class="card">
    <h2>Stats (raw data)</h2>
    <div class="value">{formatBytes(statsBytes) ?? "—"}</div>
    <div class="foot">
      {stats ? "restic stats --mode raw-data" : "not available"}
    </div>
  </div>
  <div class="card">
    <h2>State file says</h2>
    <div class="value">{formatBytes(stateRepoBytes) ?? "—"}</div>
    <div class="foot">
      {#if drift === null}
        no cross-check possible
      {:else}
        drift {drift >= 0 ? "+" : "−"}{formatBytes(Math.abs(drift))}
      {/if}
    </div>
  </div>
  <div class="card">
    <h2>restic version</h2>
    <div class="value" style="font-size:18px">
      {restic.value?.version ?? "—"}
    </div>
    <div class="foot">pinned 0.18.1 in the image</div>
  </div>
</div>

<div class="card">
  <h2>Snapshot inventory</h2>
  {#if snapshots.length === 0}
    <p class="empty">No snapshots returned.</p>
  {:else}
    <table>
      <thead>
        <tr
          ><th>Short ID</th><th>Time</th><th>Host</th><th>Tags</th><th
            class="num">Paths</th
          ></tr
        >
      </thead>
      <tbody>
        {#each [...snapshots].reverse() as snap (snap.id)}
          <tr>
            <td class="mono">{snap.short_id ?? snap.id?.slice(0, 8)}</td>
            <td>{when(snap.time)}</td>
            <td>{snap.hostname ?? "—"}</td>
            <td class="mono">{(snap.tags ?? []).join(", ") || "—"}</td>
            <td class="num">{(snap.paths ?? []).length}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
