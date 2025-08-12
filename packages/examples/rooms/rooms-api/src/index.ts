import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { randomUUID } from 'crypto';

// Data models
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

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const rooms: Map<string, Room> = new Map();

function getRandomColor(): string {
  const colors = ['#ff6b6b', '#ff922b', '#fcc419', '#51cf66', '#339af0', '#845ef7', '#f06595'];
  return colors[Math.floor(Math.random() * colors.length)];
}

const emojiPalette = ['😀','😎','🦊','🐼','🐸','🐯','🐵','🐰','🐹','🦄','🐙','🐳','🐝','🍀','🌈','⭐'];
function getRandomEmoji(): string {
  return emojiPalette[Math.floor(Math.random() * emojiPalette.length)];
}

function ensureRoom(roomId: string, name?: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      name: name ?? `Room ${roomId.slice(0, 4)}`,
      createdAt: Date.now(),
      users: new Map(),
      chat: [],
      map: { width: 20, height: 12 }
    };
    rooms.set(roomId, room);
  }
  return room;
}

// REST endpoints
app.get('/api/rooms', (_req, res) => {
  const list = Array.from(rooms.values()).map(r => ({ id: r.id, name: r.name, numUsers: r.users.size }));
  res.json(list);
});

app.post('/api/rooms', (req, res) => {
  const id = randomUUID();
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : undefined;
  const room = ensureRoom(id, name);
  res.json({ id: room.id });
});

app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, name: room.name, users: Object.fromEntries(room.users), chat: room.chat, map: room.map });
});

// WebSocket handling
interface ClientInfo {
  ws: WebSocket;
  userId?: string;
  roomId?: string;
}

const clients = new Set<ClientInfo>();

function broadcastToRoom(roomId: string, payload: any) {
  const text = JSON.stringify(payload);
  for (const client of clients) {
    if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(text);
    }
  }
}

wss.on('connection', (ws) => {
  const info: ClientInfo = { ws };
  clients.add(info);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const type: string = msg.type;
      if (type === 'join') {
        const roomId: string = msg.roomId;
        const name: string | undefined = msg.name;
        const emoji: string | undefined = msg.emoji;
        const room = ensureRoom(roomId);
        const userId = randomUUID();
        const user: User = {
          id: userId,
          name: name ?? `User ${userId.slice(0, 4)}`,
          color: getRandomColor(),
          emoji: emoji ?? getRandomEmoji(),
          x: Math.floor(room.map.width / 2),
          y: Math.floor(room.map.height / 2)
        };
        room.users.set(userId, user);
        info.userId = userId;
        info.roomId = roomId;
        // Send initial state to this client
        ws.send(JSON.stringify({ type: 'joined', roomId, userId, state: serializeRoom(room) }));
        // Broadcast presence update
        broadcastToRoom(roomId, { type: 'presence', roomId, users: Object.fromEntries(room.users) });
      } else if (type === 'move') {
        const { roomId, dx, dy } = msg as { roomId: string; dx: number; dy: number };
        if (!info.userId || info.roomId !== roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const user = room.users.get(info.userId);
        if (!user) return;
        user.x = clamp(user.x + Math.trunc(dx), 0, room.map.width - 1);
        user.y = clamp(user.y + Math.trunc(dy), 0, room.map.height - 1);
        broadcastToRoom(roomId, { type: 'moved', roomId, user });
      } else if (type === 'chat') {
        const { roomId, text } = msg as { roomId: string; text: string };
        if (!info.userId || info.roomId !== roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const message: ChatMessage = { id: randomUUID(), userId: info.userId, text: String(text ?? '').slice(0, 500), ts: Date.now() };
        room.chat.push(message);
        broadcastToRoom(roomId, { type: 'chat', roomId, message });
      }
    } catch (err) {
      // ignore malformed
    }
  });

  ws.on('close', () => {
    if (info.roomId && info.userId) {
      const room = rooms.get(info.roomId);
      if (room) {
        room.users.delete(info.userId);
        broadcastToRoom(info.roomId, { type: 'presence', roomId: info.roomId, users: Object.fromEntries(room.users) });
      }
    }
    clients.delete(info);
  });
});

function serializeRoom(room: Room) {
  return {
    id: room.id,
    name: room.name,
    users: Object.fromEntries(room.users),
    chat: room.chat,
    map: room.map
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const PORT = Number(process.env.PORT || 8787);
httpServer.listen(PORT, () => {
  console.log(`Rooms API listening on http://localhost:${PORT}`);
});