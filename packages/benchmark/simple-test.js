#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('🧪 Simple WebSocket Test...\n');

async function simpleTest() {
  const port = 9000;
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  console.log('Starting server...');
  await server.listen();
  console.log(`Server listening on port ${port}`);
  
  console.log('Creating client...');
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  console.log('Connecting client...');
  const start = performance.now();
  await client.connect();
  const connectTime = performance.now() - start;
  console.log(`✅ Connected in ${connectTime.toFixed(2)}ms`);
  
  console.log('Testing ping...');
  const pingStart = performance.now();
  const pong = await client.get('/ping');
  const pingTime = performance.now() - pingStart;
  console.log(`✅ Ping response: ${pong.data} (${pingTime.toFixed(2)}ms)`);
  
  console.log('Testing echo...');
  const echoStart = performance.now();
  const echo = await client.post('/echo', { message: 'hello world' });
  const echoTime = performance.now() - echoStart;
  console.log(`✅ Echo response: ${JSON.stringify(echo.data)} (${echoTime.toFixed(2)}ms)`);
  
  console.log('Closing client...');
  await client.close();
  
  console.log('Stopping server...');
  await server.close();
  
  console.log('\n🎉 Simple test completed successfully!');
  console.log(`Connection time: ${connectTime.toFixed(2)}ms`);
  console.log(`Ping time: ${pingTime.toFixed(2)}ms`);
  console.log(`Echo time: ${echoTime.toFixed(2)}ms`);
}

try {
  await simpleTest();
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}