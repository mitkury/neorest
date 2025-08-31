## Rooms Example (SvelteKit + neorest)

A minimal multi-room world where users can:
- View a list of rooms
- Create a new room
- Enter a room to see a top-down grid with avatars (emoji + colored circle)
- Move with arrow keys or WASD
- Chat at the bottom of the page
- Sync state in real time (neorest subscriptions)

### Run locally (one command)
From this folder:

```bash
cd packages/examples/rooms
npm install
npm run dev
```

This starts both:
- API: neorest `neorest/node` on http://localhost:8787
- Web: SvelteKit dev server on http://localhost:5173

Open the web app, create a room, open it in two tabs, move around and chat.

### Structure
- `rooms-api`: neorest server (NodeRouter). Routes:
  - `GET /api/rooms` — list rooms
  - `POST /api/rooms` — create room
  - `GET /api/rooms/:id` — room state
  - `POST /api/rooms/:id/join` — join room (assigns userId and returns state)
  - `POST /api/rooms/:id/move` — move current user
  - `POST /api/rooms/:id/chat` — send chat message
- Outgoing channels (subscribe from client):
  - `/rooms/:id/presence` — snapshot of users on join/leave
  - `/rooms/:id/moved` — single user moved
  - `/rooms/:id/chat` — new chat messages
- `rooms-web`: SvelteKit app using `neorest` client (`auto` strategy), calling the routes above and subscribing to channels.

### Notes
- No auth; users are anonymous. Server assigns color and emoji.
- Server keeps everything in-memory.
- The example uses a single neorest router server for both HTTP-like routes and real-time subscriptions.