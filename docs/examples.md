# Simple examples

The examples build one idea at a time. Start a small TypeScript project with:

```bash
npm install neorest
npm install --save-dev tsx
```

Save a server example as `server.ts`, then run it with `npx tsx server.ts`.
The Neorest server requires Node.js 20 or newer.

## 1. A route you can call with curl

```ts
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ port: 8080 });

router.onGet('/hello', (context) => {
  context.response = { message: 'Hello!' };
});

await router.start();
```

Registered routes are regular HTTP routes by default:

```bash
curl http://localhost:8080/hello
```

## 2. Call the same route with a Neorest client

The server is unchanged. In a browser application:

```ts
import { Client } from 'neorest';

const client = new Client('http://localhost:8080', 'auto');
await client.connect();

const response = await client.get<{ message: string }>('/hello');
console.log(response.data.message);
```

`auto` starts with HTTP, then uses the best transport advertised by the
server. Your route calls stay the same if the transport changes.

## 3. Send data with POST

Server:

```ts
router.onPost('/greet', (context) => {
  const { name } = context.data as { name: string };
  context.response = { message: `Hello, ${name}!` };
});
```

Client:

```ts
const response = await client.post<{ message: string }>('/greet', {
  name: 'Ada',
});

console.log(response.data.message);
```

## 4. Read a route parameter

Parameters use `:name` in server route patterns. Clients send the concrete
path.

Server:

```ts
router.onGet('/users/:userId', (context) => {
  context.response = { id: context.params.userId };
});
```

Client:

```ts
const response = await client.get<{ id: string }>('/users/42');
console.log(response.data.id);
```

## 5. Subscribe to real-time changes

This counter returns its current value and broadcasts every change.

Server:

```ts
let count = 0;

router.onGet('/counter', (context) => {
  context.response = { count };
});

router.onPost('/counter', (context) => {
  count += 1;
  context.response = { count };
  router.broadcastUpdate('/counter', { count }, context.sender);
});
```

Client:

```ts
const initial = await client.get<{ count: number }>('/counter');
console.log('current count:', initial.data.count);

await client.subscribe<{ count: number }>('/counter', (event) => {
  console.log('new count:', event.data.count);
});

const updated = await client.post<{ count: number }>('/counter');
console.log('my update:', updated.data.count);
```

Passing `context.sender` excludes the caller from the broadcast because it
already receives the new value in the POST response.

## Runnable browser examples

- [Ping](../packages/playground/simplest) is the smallest complete app.
- [Chat](../packages/playground/chat) adds a snapshot, subscription, and POST.
