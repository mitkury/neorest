import { NodeRouter } from '../../../../router-node/src/NodeRouter.ts';
import { randomUUID } from 'crypto';
import type { ServerConnection } from '@neorest/router-core';

interface User {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  x: number;
  y: number;
}

interface ChatMessage {
  id: string;
  userId: string;
  text: string;
  ts: number;
}

interface Room {
  id: string;
  name: string;
  createdAt: number;
  users: Map<string, User>;
  chat: ChatMessage[];
  map: { width: number; height: number };
}

const router = new NodeRouter({ hostname: '0.0.0.0', port: Number(process.env.PORT || 8787) });

const rooms: Map<string, Room> = new Map();
const connPresence: Map<string, { roomId: string; userId: string }> = new Map();

function getRandomColor(): string {
  const colors = ['#ff6b6b', '#ff922b', '#fcc419', '#51cf66', '#339af0', '#845ef7', '#f06595'];
  return colors[Math.floor(Math.random() * colors.length)];
}

const emojiPalette = ['😀','😎','🦊','🐼','🐸','🐯','🐵','🐰','🐹','🦄','🐙','🐳','🐝','🍀','🌈','⭐'];
function getRandomEmoji(): string { return emojiPalette[Math.floor(Math.random() * emojiPalette.length)]; }

function ensureRoom(roomId: string, name?: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, name: name ?? `Room ${roomId.slice(0,4)}`, createdAt: Date.now(), users: new Map(), chat: [], map: { width: 20, height: 12 } };
    rooms.set(roomId, room);
  }
  return room;
}

function serializeRoom(room: Room) {
  return { id: room.id, name: room.name, users: Object.fromEntries(room.users), chat: room.chat, map: room.map };
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

// HTTP-like API
router.onGet('/api/rooms', async (ctx) => {
  ctx.response = Array.from(rooms.values()).map(r => ({ id: r.id, name: r.name, numUsers: r.users.size }));
});

router.onPost('/api/rooms', async (ctx) => {
  const id = randomUUID();
  const name = typeof ctx.data?.name === 'string' && ctx.data.name.trim() ? ctx.data.name.trim() : undefined;
  const room = ensureRoom(id, name);
  ctx.response = { id: room.id };
});

router.onGet('/api/rooms/:id', async (ctx) => {
  const room = rooms.get(ctx.params.id);
  if (!room) {
    ctx.statusCode = 404; ctx.error = 'Room not found'; return;
  }
  ctx.response = serializeRoom(room);
});

// Domain actions over neorest
router.onPost('/api/rooms/:id/join', async (ctx) => {
  const room = ensureRoom(ctx.params.id);
  const conn = ctx.sender as ServerConnection;

  // Cleanup previous presence if any
  const prev = connPresence.get(conn.getSecret());
  if (prev) {
    const prevRoom = rooms.get(prev.roomId);
    if (prevRoom) {
      prevRoom.users.delete(prev.userId);
      router.broadcastUpdate(`/rooms/${prev.roomId}/presence`, { users: Object.fromEntries(prevRoom.users) });
    }
  }

  const userId = randomUUID();
  const user: User = {
    id: userId,
    name: typeof ctx.data?.name === 'string' && ctx.data.name.trim() ? ctx.data.name.trim() : `User ${userId.slice(0,4)}`,
    color: getRandomColor(),
    emoji: typeof ctx.data?.emoji === 'string' && ctx.data.emoji.trim() ? ctx.data.emoji.trim() : getRandomEmoji(),
    x: Math.floor(room.map.width / 2),
    y: Math.floor(room.map.height / 2),
  };
  room.users.set(userId, user);
  connPresence.set(conn.getSecret(), { roomId: room.id, userId });

  // Attach cleanup on connection close once
  const originalOnClose = (conn as any).onClose;
  (conn as any).onClose = () => {
    const p = connPresence.get(conn.getSecret());
    if (p) {
      const r = rooms.get(p.roomId);
      if (r) {
        r.users.delete(p.userId);
        router.broadcastUpdate(`/rooms/${p.roomId}/presence`, { users: Object.fromEntries(r.users) });
      }
      connPresence.delete(conn.getSecret());
    }
    if (typeof originalOnClose === 'function') originalOnClose();
  };

  ctx.response = { userId, state: serializeRoom(room) };
  router.broadcastUpdate(`/rooms/${room.id}/presence`, { users: Object.fromEntries(room.users) }, conn);
});

router.onPost('/api/rooms/:id/move', async (ctx) => {
  const conn = ctx.sender as ServerConnection;
  const presence = connPresence.get(conn.getSecret());
  if (!presence || presence.roomId !== ctx.params.id) { ctx.statusCode = 403; ctx.error = 'Not in room'; return; }
  const room = rooms.get(ctx.params.id);
  if (!room) { ctx.statusCode = 404; ctx.error = 'Room not found'; return; }
  const user = room.users.get(presence.userId);
  if (!user) { ctx.statusCode = 404; ctx.error = 'User not found'; return; }
  const dx = Number(ctx.data?.dx ?? 0) | 0;
  const dy = Number(ctx.data?.dy ?? 0) | 0;
  user.x = clamp(user.x + Math.trunc(dx), 0, room.map.width - 1);
  user.y = clamp(user.y + Math.trunc(dy), 0, room.map.height - 1);
  router.broadcastUpdate(`/rooms/${room.id}/moved`, { user }, conn);
  ctx.response = { ok: true };
});

router.onPost('/api/rooms/:id/chat', async (ctx) => {
  const conn = ctx.sender as ServerConnection;
  const presence = connPresence.get(conn.getSecret());
  if (!presence || presence.roomId !== ctx.params.id) { ctx.statusCode = 403; ctx.error = 'Not in room'; return; }
  const room = rooms.get(ctx.params.id);
  if (!room) { ctx.statusCode = 404; ctx.error = 'Room not found'; return; }
  const text = String(ctx.data?.text ?? '').slice(0, 500);
  if (!text) { ctx.statusCode = 400; ctx.error = 'Empty message'; return; }
  const message: ChatMessage = { id: randomUUID(), userId: presence.userId, text, ts: Date.now() };
  room.chat.push(message);
  router.broadcastPost(`/rooms/${room.id}/chat`, { message }, conn);
  ctx.response = { ok: true };
});

// Outgoing channels (validate subscriptions). For demo, allow all.
router.onValidateBroadcast('/rooms/:id/presence', () => true);
router.onValidateBroadcast('/rooms/:id/moved', () => true);
router.onValidateBroadcast('/rooms/:id/chat', () => true);

router.listen().then(() => {
  console.log('Rooms API (neorest-node) listening on http://localhost:' + (process.env.PORT || 8787));
});