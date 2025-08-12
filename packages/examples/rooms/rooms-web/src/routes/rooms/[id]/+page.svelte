<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';

  type User = { id: string; name: string; color: string; emoji?: string; x: number; y: number };
  type ChatMessage = { id: string; userId: string; text: string; ts: number };
  type MapSize = { width: number; height: number };

  const apiBase = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:8787';
  const wsBase = (import.meta.env.VITE_WS_BASE as string) || 'ws://localhost:8787/ws';

  let roomId: string;
  let ws: WebSocket | null = null;
  let userId: string | null = null;

  let users: Record<string, User> = {};
  let chat: ChatMessage[] = [];
  let map: MapSize = { width: 20, height: 12 };

  let chatText = '';
  let canvasEl: HTMLCanvasElement;
  const tileSize = 32;

  $: roomId = $page.params.id;

  function connect() {
    ws = new WebSocket(wsBase);
    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: 'join', roomId }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') {
        userId = msg.userId;
        const state = msg.state as { users: Record<string, User>; chat: ChatMessage[]; map: MapSize };
        users = state.users || {};
        chat = state.chat || [];
        map = state.map || map;
        draw();
      } else if (msg.type === 'presence') {
        users = msg.users || {};
        draw();
      } else if (msg.type === 'moved') {
        const u: User = msg.user;
        users[u.id] = u;
        draw();
      } else if (msg.type === 'chat') {
        chat = [...chat, msg.message];
      }
    };
    ws.onclose = () => {
      ws = null;
    };
  }

  function sendMove(dx: number, dy: number) {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'move', roomId, dx, dy }));
  }

  function keydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') sendMove(0, -1);
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') sendMove(0, 1);
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') sendMove(-1, 0);
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') sendMove(1, 0);
  }

  function sendChat() {
    const text = chatText.trim();
    if (!text || !ws) return;
    ws.send(JSON.stringify({ type: 'chat', roomId, text }));
    chatText = '';
  }

  function draw() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    const width = map.width * tileSize;
    const height = map.height * tileSize;
    canvasEl.width = width;
    canvasEl.height = height;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#e2e8f0';
    for (let x = 0; x <= map.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * tileSize + 0.5, 0);
      ctx.lineTo(x * tileSize + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y <= map.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * tileSize + 0.5);
      ctx.lineTo(width, y * tileSize + 0.5);
      ctx.stroke();
    }

    for (const uid in users) {
      const u = users[uid];
      const cx = u.x * tileSize + tileSize / 2;
      const cy = u.y * tileSize + tileSize / 2;
      // Circle avatar
      ctx.beginPath();
      ctx.fillStyle = u.color || '#111827';
      ctx.arc(cx, cy, tileSize * 0.35, 0, Math.PI * 2);
      ctx.fill();

      const label = u.emoji || '🙂';
      ctx.font = `${Math.floor(tileSize * 0.7)}px system-ui, emoji`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + 1);

      if (u.id === userId) {
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize * 0.42, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  let unsub: () => void;
  onMount(() => {
    connect();
    const handler = (e: KeyboardEvent) => keydown(e);
    window.addEventListener('keydown', handler);
    unsub = () => window.removeEventListener('keydown', handler);
  });

  onDestroy(() => {
    unsub?.();
    ws?.close();
  });
</script>

<div style="display:flex; flex-direction:column; gap:12px; max-width: 900px; margin: 16px auto; padding: 0 12px;">
  <a href="/" style="color:#2563eb; text-decoration:none;">← Back</a>

  <div style="border:1px solid #e5e7eb; border-radius:8px; overflow:auto;">
    <canvas bind:this={canvasEl} style="display:block; background:white;"></canvas>
  </div>

  <div style="display:flex; flex-direction:column; gap:8px;">
    <div style="max-height: 200px; overflow:auto; border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#fff;">
      {#each chat as m}
        <div style="display:flex; gap:8px; align-items:baseline;">
          <span style="color:#6b7280; font-size:12px;">{new Date(m.ts).toLocaleTimeString()}</span>
          <span>{users[m.userId]?.emoji || '🙂'}</span>
          <span>{m.text}</span>
        </div>
      {/each}
    </div>
    <div style="display:flex; gap:8px;">
      <input placeholder="Say something" bind:value={chatText} on:keydown={(e)=> e.key==='Enter' && sendChat()} style="flex:1; padding:8px 10px; border:1px solid #e5e7eb; border-radius:8px;" />
      <button on:click={sendChat} style="padding:8px 12px; border-radius:8px; border:1px solid #111; background:#111; color:#fff;">Send</button>
    </div>
  </div>
</div>