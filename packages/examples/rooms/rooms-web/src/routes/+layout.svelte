<script>
  export let data;
</script>

<svelte:head>
  <title>Rooms Example</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div style="min-height:100svh; display:flex; flex-direction:column;">
  <header style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; display:flex; align-items:center; gap:8px;">
    <span style="font-weight:700;">Rooms</span>
  </header>
  <main style="flex:1; display:flex; flex-direction:column;">
    <slot />
  </main>
</div>