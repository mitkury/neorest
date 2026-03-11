#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('🚀 Quick Benchmark Test...\n');

async function quickBenchmark() {
  const results = [];
  
  // Test 1: Single connection
  console.log('Test 1: Single Connection');
  const port = 9000;
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  const start = performance.now();
  await client.connect();
  const connectTime = performance.now() - start;
  results.push({ test: 'Connection', time: connectTime });
  console.log(`✅ Connected in ${connectTime.toFixed(2)}ms`);
  
  // Test 2: Single message
  console.log('Test 2: Single Message');
  const pingStart = performance.now();
  const pong = await client.get('/ping');
  const pingTime = performance.now() - pingStart;
  results.push({ test: 'Ping', time: pingTime });
  console.log(`✅ Ping in ${pingTime.toFixed(2)}ms`);
  
  // Test 3: Multiple messages
  console.log('Test 3: 5 Messages');
  const messagesStart = performance.now();
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(client.post('/echo', { message: i }));
  }
  const responses = await Promise.all(promises);
  const messagesTime = performance.now() - messagesStart;
  results.push({ test: '5 Messages', time: messagesTime });
  console.log(`✅ 5 messages in ${messagesTime.toFixed(2)}ms`);
  
  await client.close();
  await server.close();
  
  // Summary
  console.log('\n📊 Quick Benchmark Results:');
  console.log('─'.repeat(40));
  results.forEach(({ test, time }) => {
    console.log(`${test.padEnd(15)} ${time.toFixed(2)}ms`);
  });
  
  const totalTime = results.reduce((sum, r) => sum + r.time, 0);
  console.log('─'.repeat(40));
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  
  console.log('\n🎉 Quick benchmark completed successfully!');
}

try {
  await quickBenchmark();
} catch (error) {
  console.error('❌ Benchmark failed:', error.message);
  process.exit(1);
}