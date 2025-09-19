import { NodeRouter } from 'neorest/node';

// In-memory chat state
type ChatMessage = { id: string; text: string; timestamp: number };
const messages: ChatMessage[] = [];

// Create chat server (separate port to avoid conflicts with other playgrounds)
const router = new NodeRouter({ port: 3002 });

// GET /  => return all messages
router.onGet('/', (ctx) => {
  ctx.response = { messages };
});

// POST / => create a new message and broadcast it
router.onPost('/', (ctx) => {
  console.log('POST /', ctx.data);
  const text = (ctx.data && typeof ctx.data.text === 'string') ? ctx.data.text : '';
  const trimmed = text.trim();
  if (!trimmed) {
    ctx.statusCode = 400;
    ctx.response = { error: 'text is required' };
    return;
  }
  const msg: ChatMessage = { id: crypto.randomUUID(), text: trimmed, timestamp: Date.now() };
  messages.push(msg);
  ctx.response = msg;
  // broadcast to subscribers of '/'
  router.broadcastPost('/', msg, ctx.sender);
});

// Allow broadcast delivery to the single room '/'
router.onValidateBroadcast('/', () => true);

// Start the server
console.log('💬 Chat server listening on http://localhost:3002');
console.log('🌐 HTTP: GET / -> { messages }, POST / -> message');
console.log('📡 SUBSCRIBE to / for real-time new messages');

await router.listen();