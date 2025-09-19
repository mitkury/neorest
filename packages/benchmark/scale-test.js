#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('🚀 Scale Test - 10,000 Messages...\n');

async function scaleTest(messageCount) {
  const results = [];
  
  console.log(`Testing with ${messageCount} messages...`);
  const port = 9000;
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  // Connection time
  const connectStart = performance.now();
  await client.conn.connect();
  const connectTime = performance.now() - connectStart;
  console.log(`✅ Connected in ${connectTime.toFixed(2)}ms`);
  
  // Message throughput test
  console.log(`Sending ${messageCount} messages...`);
  const messagesStart = performance.now();
  const promises = [];
  for (let i = 0; i < messageCount; i++) {
    promises.push(client.post('/echo', { message: i, timestamp: Date.now() }));
  }
  const responses = await Promise.all(promises);
  const messagesTime = performance.now() - messagesStart;
  
  // Calculate metrics
  const messagesPerSecond = (messageCount / messagesTime) * 1000;
  const avgTimePerMessage = messagesTime / messageCount;
  
  console.log(`✅ ${messageCount} messages completed in ${messagesTime.toFixed(2)}ms`);
  console.log(`📊 Throughput: ${messagesPerSecond.toFixed(0)} messages/second`);
  console.log(`📊 Average: ${avgTimePerMessage.toFixed(3)}ms per message`);
  
  await client.close();
  await server.close();
  
  return {
    messageCount,
    connectTime,
    messagesTime,
    messagesPerSecond,
    avgTimePerMessage
  };
}

try {
  const result = await scaleTest(10000);
  
  console.log('\n📊 Scale Test Results (10,000 messages):');
  console.log('─'.repeat(50));
  console.log(`Connection time:     ${result.connectTime.toFixed(2)}ms`);
  console.log(`Messages time:       ${result.messagesTime.toFixed(2)}ms`);
  console.log(`Throughput:          ${result.messagesPerSecond.toFixed(0)} msg/sec`);
  console.log(`Avg per message:     ${result.avgTimePerMessage.toFixed(3)}ms`);
  console.log('─'.repeat(50));
  
  console.log('\n🎉 Scale test completed successfully!');
  
} catch (error) {
  console.error('❌ Scale test failed:', error.message);
  process.exit(1);
}