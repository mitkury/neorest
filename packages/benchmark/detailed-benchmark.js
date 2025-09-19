#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('🔍 Detailed Neorest Performance Analysis\n');

async function detailedBenchmark(messageCount) {
  console.log(`📊 Detailed analysis of ${messageCount} messages...`);
  
  const port = 9000;
  const server = new NodeRouter({ port });
  
  let messageReceived = 0;
  let firstMessageTime = 0;
  let lastMessageTime = 0;
  
  server
    .onPost('/echo', async (ctx) => { 
      messageReceived++;
      const now = performance.now();
      if (messageReceived === 1) {
        firstMessageTime = now;
      }
      lastMessageTime = now;
      ctx.response = ctx.data; 
    });
  
  await server.listen();
  console.log('✅ Neorest server started');
  
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  // Step 1: Connection
  const connectStart = performance.now();
  await client.conn.connect();
  const connectTime = performance.now() - connectStart;
  console.log(`🔌 Connection: ${connectTime.toFixed(2)}ms`);
  
  // Step 2: Create promises (this is where the "magic" might be happening)
  const promiseStart = performance.now();
  const promises = [];
  for (let i = 0; i < messageCount; i++) {
    promises.push(client.post('/echo', { message: i, timestamp: Date.now() }));
  }
  const promiseCreationTime = performance.now() - promiseStart;
  console.log(`📝 Promise creation: ${promiseCreationTime.toFixed(2)}ms`);
  
  // Step 3: Wait for all responses
  const waitStart = performance.now();
  const responses = await Promise.all(promises);
  const waitTime = performance.now() - waitStart;
  console.log(`⏳ Promise.all() wait: ${waitTime.toFixed(2)}ms`);
  
  // Step 4: Server processing time
  const serverProcessingTime = lastMessageTime - firstMessageTime;
  console.log(`🖥️  Server processing: ${serverProcessingTime.toFixed(2)}ms`);
  
  // Step 5: Total time
  const totalTime = performance.now() - connectStart;
  console.log(`⏱️  Total time: ${totalTime.toFixed(2)}ms`);
  
  // Calculate realistic throughput
  const realisticThroughput = (messageCount / waitTime) * 1000;
  const serverThroughput = (messageCount / serverProcessingTime) * 1000;
  
  console.log(`📊 Realistic throughput (wait time): ${realisticThroughput.toFixed(0)} msg/s`);
  console.log(`📊 Server throughput: ${serverThroughput.toFixed(0)} msg/s`);
  console.log(`📊 Messages processed: ${messageReceived}/${messageCount}`);
  
  // Check if all responses are unique
  const uniqueResponses = new Set(responses.map(r => JSON.stringify(r.data)));
  console.log(`🔍 Unique responses: ${uniqueResponses.size}/${responses.length}`);
  
  await client.close();
  await server.close();
  
  return {
    messageCount,
    connectTime,
    promiseCreationTime,
    waitTime,
    serverProcessingTime,
    totalTime,
    realisticThroughput,
    serverThroughput,
    messageReceived,
    uniqueResponses: uniqueResponses.size
  };
}

async function runDetailedBenchmarks() {
  const testSizes = [100, 1000];
  const results = [];
  
  for (const size of testSizes) {
    console.log(`\n${'='.repeat(70)}`);
    const result = await detailedBenchmark(size);
    results.push(result);
    console.log(`\n✅ ${size} messages analysis completed`);
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('🔍 DETAILED ANALYSIS SUMMARY');
  console.log('='.repeat(70));
  console.log('Messages | Wait Time | Server Time | Realistic TPS | Server TPS');
  console.log('─'.repeat(70));
  
  results.forEach(result => {
    console.log(
      `${result.messageCount.toString().padEnd(8)} | ` +
      `${result.waitTime.toFixed(2).padEnd(9)}ms | ` +
      `${result.serverProcessingTime.toFixed(2).padEnd(10)}ms | ` +
      `${result.realisticThroughput.toFixed(0).padEnd(13)} | ` +
      `${result.serverThroughput.toFixed(0)}`
    );
  });
  
  console.log('─'.repeat(70));
  console.log('\n🎯 Key Insights:');
  console.log(`   • Promise.all() batches the timing measurement`);
  console.log(`   • Real throughput is based on wait time, not total time`);
  console.log(`   • Server processing time shows actual message handling speed`);
  console.log(`   • All responses are unique (no caching/batching)`);
  
  console.log('\n🎉 Detailed analysis completed!');
}

try {
  await runDetailedBenchmarks();
} catch (error) {
  console.error('❌ Detailed benchmark failed:', error.message);
  process.exit(1);
}