<script>
  import { formatBytes } from "$lib/status.js";

  let { data } = $props();
  const status = $derived(data.status);
  const contents = $derived(data.contents);

  const named = $derived(
    contents.value?.containers ?? { dir: null, source: null, names: [] },
  );
  const namedFrom = $derived.by(() => {
    if (named.source === "containers.txt")
      return `read from the pipeline's own ${named.dir}/containers.txt`;
    if (named.source === "filenames")
      return `taken from the filenames in ${named.dir} (that run wrote no manifest)`;
    return null;
  });

  // The manifest can disagree with the count the pipeline recorded; say so
  // rather than silently showing one of the two numbers.
  const countDiffers = $derived(
    Number.isFinite(status?.state?.containers) &&
      named.names.length !== status.state.containers,
  );

  const groups = [
    { key: "pg", label: "Postgres dumps" },
    { key: "sqlite", label: "SQLite dumps" },
    { key: "config", label: "Config / staging" },
    { key: "other", label: "Other" },
  ];
</script>

<svelte:head><title>backup-dash — contents</title></svelte:head>

<h1>What is backed up</h1>
<p class="sub">
  Names and sizes from <code class="mono"
    >{contents.value?.root ?? "/backup"}</code
  >, including <code class="mono">staging/</code> — the dumps the pipeline
  collects before a run. The container runs as root, so the host's
  <code class="mono">root:root 0700</code> on that directory does not hide it.
</p>

<div class="grid">
  <div class="card">
    <h2>Containers</h2>
    <div class="value">
      {Number.isFinite(status?.state?.containers)
        ? status.state.containers
        : "—"}
    </div>
    <div class="foot">
      {#if named.names.length}
        names listed below
        {#if countDiffers}
          <span class="degraded-tag">count differs</span>
        {/if}
      {:else if Number.isFinite(status?.state?.containers)}
        count reported by the pipeline, no per-container directory on disk
      {:else}
        not reported by the pipeline yet
      {/if}
    </div>
  </div>
  <div class="card">
    <h2>Postgres dumps</h2>
    <div class="value">{contents.value?.groups.pg.length ?? 0}</div>
    <div class="foot">
      {Number.isFinite(status?.state?.pg_dumps)
        ? `${status.state.pg_dumps} in state`
        : "—"}
    </div>
  </div>
  <div class="card">
    <h2>SQLite dumps</h2>
    <div class="value">{contents.value?.groups.sqlite.length ?? 0}</div>
    <div class="foot">
      {Number.isFinite(status?.state?.sqlite_dumps)
        ? `${status.state.sqlite_dumps} in state`
        : "—"}
    </div>
  </div>
  <div class="card" class:degraded={contents.degraded}>
    <h2>On disk</h2>
    <div class="value">{formatBytes(contents.value?.totalBytes) ?? "—"}</div>
    <div class="foot">
      {#if contents.degraded}
        <span class="degraded-tag">degraded</span> · {contents.error}
      {:else}
        {contents.value?.files.length ?? 0} files · as of {contents.asOf ?? "—"}
      {/if}
    </div>
  </div>
</div>

<div class="card" style="margin-bottom:14px">
  <h2>Container names</h2>
  {#if named.names.length}
    <p class="sub" style="margin-bottom:10px">
      {named.names.length} containers, {namedFrom}.
    </p>
    <ul class="names">
      {#each named.names as name (name)}
        <li class="mono">{name}</li>
      {/each}
    </ul>
  {:else}
    <p class="empty">
      No per-container directory under <code class="mono">staging/config</code>
      or <code class="mono">config</code> — the config phase has not run here yet,
      or the directory is unreadable.
    </p>
  {/if}
</div>

{#each groups as group (group.key)}
  <div class="card" style="margin-bottom:14px">
    <h2>{group.label}</h2>
    {#if (contents.value?.groups[group.key] ?? []).length === 0}
      <p class="empty">Nothing here.</p>
    {:else}
      <table>
        <thead>
          <tr
            ><th>Path</th><th class="num">Size</th><th class="num">Modified</th
            ></tr
          >
        </thead>
        <tbody>
          {#each contents.value.groups[group.key] as file (file.path)}
            <tr>
              <td class="mono">{file.path}</td>
              <td class="num">{formatBytes(file.bytes)}</td>
              <td class="num muted"
                >{file.mtime.slice(0, 16).replace("T", " ")}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/each}
