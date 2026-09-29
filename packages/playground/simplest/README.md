# Ping

The smallest browser example: connect a Neorest client and call one `GET`
route.

```bash
npm install
npm run dev
```

Open <http://localhost:3001>, then click **GET /ping**.

- [`server.ts`](server.ts) registers the route.
- [`index.html`](index.html) connects the client and calls it.

The client uses `auto`, so it can choose the best transport available without
changing the route code.
