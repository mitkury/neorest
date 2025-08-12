## Rooms Example (SvelteKit + Node.js WS)

Goal: A minimal multi-room world where users can:
- View a list of rooms
- Create a new room
- Enter a room to see a top-down map with other users as simple avatars (emoji or colored shapes)
- Move with arrow keys or WASD
- Chat in a room-level chat area at the bottom of the page
- Sync state in real time across all connected clients

### Architecture
- `rooms-web`: SvelteKit frontend app
- `rooms-api`: Node.js REST + WebSocket server
- Data is stored in-memory on the API server for simplicity (not persisted)

### Data Model (in-memory)
- Room: `{ id: string, name: string, createdAt: number, users: Map<userId, User>, chat: ChatMessage[], map: { width: number, height: number } }`
- User: `{ id: string, name: string, color: string, emoji?: string, x: number, y: number }`
- ChatMessage: `{ id: string, userId: string, text: string, ts: number }`

### REST Endpoints (HTTP)
- `GET /api/rooms` -> `[{ id, name, numUsers }]`
- `POST /api/rooms` body: `{ name?: string }` -> `{ id }`
- `GET /api/rooms/:id` -> `{ id, name, users, chat, map }`

### WebSocket Events (WS `/ws`)
Client -> Server:
- `join`: `{ type: "join", roomId: string, name?: string, emoji?: string }`
- `move`: `{ type: "move", roomId: string, dx: number, dy: number }`
- `chat`: `{ type: "chat", roomId: string, text: string }`

Server -> Client:
- `joined`: `{ type: "joined", roomId, userId, state }` // initial full state
- `presence`: `{ type: "presence", roomId, users }` // users map snapshot
- `moved`: `{ type: "moved", roomId, user: User }`
- `chat`: `{ type: "chat", roomId, message: ChatMessage }`
- `room`: `{ type: "room", roomId, state }` // full state broadcast (e.g., on join/leave)

### Movement
- Discrete grid movement: 1 unit per key press (WASD/Arrows)
- Server clamps position to map bounds: `0 <= x < width`, `0 <= y < height`

### UX
- Home (`/`): list rooms, create room form
- Room (`/rooms/[id]`):
  - Canvas showing map and user avatars
  - Chat history and input at bottom
  - Local player highlighted

### Notes
- Dev-only example; no auth. User is anonymous with generated color/emoji if not provided.
- Simple conflict model: server is source of truth; clients render snapshots from server events.