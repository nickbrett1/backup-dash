<script>
  import { page } from "$app/state";
  import "../app.css";

  let { children } = $props();

  const links = [
    { href: "/", label: "Overview" },
    { href: "/contents", label: "Contents" },
    { href: "/snapshots", label: "NAS snapshots" },
    { href: "/repo", label: "Restic repo" },
  ];

  // /tile is embedded in Homepage as an iframe: no chrome, no nav.
  const bare = $derived(page.url.pathname.startsWith("/tile"));
</script>

<svelte:head>
  <title>backup-dash</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{#if bare}
  {@render children()}
{:else}
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/">backup<span>-dash</span></a>
      <nav>
        {#each links as link (link.href)}
          <a
            href={link.href}
            class:active={page.url.pathname === link.href}
            aria-current={page.url.pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </a>
        {/each}
      </nav>
    </header>
    <main>
      {@render children()}
    </main>
  </div>
{/if}
