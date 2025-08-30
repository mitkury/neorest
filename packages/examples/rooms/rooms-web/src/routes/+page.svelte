<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Client } from 'neorest';

  type RoomBrief = { id: string; name: string; numUsers: number };
  let rooms: RoomBrief[] = [];
  let name = '';
  let client: Client;
  const apiBase = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:8787';

  async function loadRooms() {
    const res = await client.get<RoomBrief[]>('/api/rooms');
    rooms = (res.data as any) || [];
  }

  async function createRoom() {
    const res = await client.post<{ id: string }>('/api/rooms', { name: name || undefined });
    const id = (res.data as any)?.id;
    if (id) goto(`/rooms/${id}`);
  }

  onMount(async () => {
    client = new Client(apiBase, 'auto');
    await (client as any).conn.connect();
    await loadRooms();
  });
</script>

<div style="max-width: 720px; margin: 24px auto; padding: 0 16px; display:flex; flex-direction:column; gap:16px;">
  <div style="display:flex; gap:8px;">
    <input placeholder="New room name (optional)" bind:value={name} style="flex:1; padding:8px 10px; border:1px solid #e5e7eb; border-radius:8px;" />
    <button on:click={createRoom} style="padding:8px 12px; border-radius:8px; border:1px solid #111; background:#111; color:#fff;">Create room</button>
  </div>

  <div style="display:flex; flex-direction:column; gap:8px;">
    {#if rooms.length === 0}
      <div style="color:#6b7280;">No rooms yet.</div>
    {/if}
    {#each rooms as r}
      <a href={`/rooms/${r.id}`} style="display:flex; justify-content:space-between; align-items:center; padding:12px; border:1px solid #e5e7eb; border-radius:8px; text-decoration:none; color:inherit;">
        <span>{r.name || r.id}</span>
        <span style="color:#6b7280; font-size: 12px;">{r.numUsers} online</span>
      </a>
    {/each}
  </div>
</div>