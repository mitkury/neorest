# Chat

A small real-time example using three operations on one route:

- `GET /messages` loads existing messages.
- subscribing to `/messages` receives new messages.
- `POST /messages` creates a message.

```bash
npm install
npm run dev
```

Open <http://localhost:3001> in two tabs and send a message from either one.

- [`server.ts`](server.ts) owns the messages and broadcasts changes.
- [`index.html`](index.html) loads, subscribes, and posts.
