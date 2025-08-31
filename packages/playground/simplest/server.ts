import { NodeRouter } from 'neorest/node';

// Create a simple server
const router = new NodeRouter({ port: 3000 });

// Simple GET route - accessible via HTTP and WebSocket
router.onGet('/ping', (ctx) => {
  ctx.response = { message: 'pong', timestamp: Date.now() };
});

// Simple POST route - accessible via HTTP and WebSocket
router.onPost('/echo', (ctx) => {
  ctx.response = { 
    message: 'echo', 
    data: ctx.data,
    timestamp: Date.now() 
  };
  
  // Broadcast to all subscribers
  router.broadcastPost('/messages', { 
    message: 'New echo received', 
    data: ctx.data 
  });
});

// Counter route - demonstrates state management
let counter = 0;
router.onGet('/counter', (ctx) => {
  ctx.response = { count: counter };
});

router.onPost('/counter/increment', (ctx) => {
  counter++;
  ctx.response = { count: counter };
  
  // Broadcast the new count to all subscribers
  router.broadcastUpdate('/counter', { 
    count: counter 
  });
});

// Allow broadcasting to messages and counter
router.onValidateBroadcast('/messages', () => true);
router.onValidateBroadcast('/counter', () => true);

// Start the server
console.log('🚀 Starting Neorest server on http://localhost:3000');
console.log('📡 WebSocket available at ws://localhost:3000');
console.log('🌐 HTTP routes: GET /ping, POST /echo, GET /counter, POST /counter/increment');
console.log('📡 Subscribe to: /messages, /counter');

await router.listen();