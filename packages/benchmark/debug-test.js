#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('🔍 Debug Test - Let\'s see what\'s really happening...\n');

async function debugTest() {
  const port = 9000;
  const server = new NodeRouter({ port });
  
  let messageCount = 0;
  let startTime = 0;
  
  server
    .onGet('/ping', async (ctx) => { 
      ctx.response = 'pong'; 
    })
    .onPost('/echo', async (ctx) => { 
      messageCount++;
      if (messageCount === 1) {
        startTime = performance.now();
        console.log(`📨 First message received at ${startTime.toFixed(2)}ms`);
      }
      if (messageCount % 100 === 0) {
        const currentTime = performance.now();
        console.log(`📨 ${messageCount} messages received at ${currentTime.toFixed(2)}ms`);
      }
      ctx.response = ctx.data; 
    });
  
  await server.listen();
  console.log('✅ Server started');
  
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  console.log('🔌 Connecting client...');
  const connectStart = performance.now();
  await client.connect();
  const connectTime = performance.now() - connectStart;
  console.log(`✅ Connected in ${connectTime.toFixed(2)}ms`);
  
  console.log('📤 Sending 100 messages with individual timing...');
  const promises = [];
  const sendTimes = [];
  
  for (let i = 0; i < 100; i++) {
    const sendStart = performance.now();
    const promise = client.post('/echo', { message: i, timestamp: Date.now() });
    promises.push(promise);
    sendTimes.push(performance.now() - sendStart);
  }
  
  const sendCompleteTime = performance.now();
  console.log(`📤 All 100 messages sent in ${(sendCompleteTime - connectTime).toFixed(2)}ms`);
  console.log(`📤 Average send time: ${(sendTimes.reduce((a, b) => a + b, 0) / sendTimes.length).toFixed(3)}ms`);
  
  console.log('⏳ Waiting for responses...');
  const responseStart = performance.now();
  const responses = await Promise.all(promises);
  const responseTime = performance.now() - responseStart;
  
  console.log(`📥 All 100 responses received in ${responseTime.toFixed(2)}ms`);
  console.log(`📥 Total messages processed: ${messageCount}`);
  console.log(`📥 Throughput: ${(messageCount / responseTime * 1000).toFixed(0)} messages/second`);
  
  // Check if responses are actually different
  const uniqueResponses = new Set(responses.map(r => JSON.stringify(r.data)));
  console.log(`🔍 Unique responses: ${uniqueResponses.size} out of ${responses.length}`);
  
  if (uniqueResponses.size === 1) {
    console.log('⚠️  WARNING: All responses are identical - this might be cached/batched!');
  }
  
  await client.close();
  await server.close();
  
  console.log('\n🎯 Debug test completed!');
}

try {
  await debugTest();
} catch (error) {
  console.error('❌ Debug test failed:', error.message);
  process.exit(1);
}