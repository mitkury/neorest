#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('🚀 Realistic Neorest Performance Benchmark\n');

async function realisticBenchmark(messageCount) {
  console.log(`📊 Testing ${messageCount} messages...`);
  
  const port = 9000;
  const server = new NodeRouter({ port });
  
  let messageReceived = 0;
  let startTime = 0;
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { 
      messageReceived++;
      if (messageReceived === 1) {
        startTime = performance.now();
      }
      if (messageReceived % Math.max(1, Math.floor(messageCount / 10)) === 0) {
        console.log(`📨 ${messageReceived} messages received`);
      }
      ctx.response = ctx.data; 
    });
  
  await server.listen();
  console.log('✅ Neorest server started');
  
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  // Connection time
  const connectStart = performance.now();
  await client.connect();
  const connectTime = performance.now() - connectStart;
  console.log(`✅ Connected in ${connectTime.toFixed(2)}ms`);
  
  // Send messages
  console.log(`📤 Sending ${messageCount} messages...`);
  const sendStart = performance.now();
  const promises = [];
  
  for (let i = 0; i < messageCount; i++) {
    promises.push(client.post('/echo', { message: i, timestamp: Date.now() }));
  }
  
  const sendTime = performance.now() - sendStart;
  console.log(`📤 All ${messageCount} messages sent in ${sendTime.toFixed(2)}ms`);
  
  // Wait for responses
  console.log('⏳ Waiting for responses...');
  const responseStart = performance.now();
  const responses = await Promise.all(promises);
  const responseTime = performance.now() - responseStart;
  
  const totalTime = performance.now() - sendStart;
  const throughput = (messageCount / totalTime) * 1000;
  const avgTimePerMessage = totalTime / messageCount;
  
  console.log(`📥 All responses received in ${responseTime.toFixed(2)}ms`);
  console.log(`📊 Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`📊 Throughput: ${throughput.toFixed(0)} messages/second`);
  console.log(`📊 Average: ${avgTimePerMessage.toFixed(3)}ms per message`);
  
  await client.close();
  await server.close();
  
  return {
    messageCount,
    connectTime,
    sendTime,
    responseTime,
    totalTime,
    throughput,
    avgTimePerMessage
  };
}

async function runBenchmarks() {
  const testSizes = [100, 1000, 10000];
  const results = [];
  
  for (const size of testSizes) {
    console.log(`\n${'='.repeat(60)}`);
    const result = await realisticBenchmark(size);
    results.push(result);
    console.log(`\n✅ ${size} messages completed`);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('🏆 FINAL BENCHMARK RESULTS');
  console.log('='.repeat(60));
  console.log('Messages | Total Time | Throughput | Avg/Message');
  console.log('─'.repeat(60));
  
  results.forEach(result => {
    console.log(
      `${result.messageCount.toString().padEnd(8)} | ` +
      `${result.totalTime.toFixed(2).padEnd(10)}ms | ` +
      `${result.throughput.toFixed(0).padEnd(10)} msg/s | ` +
      `${result.avgTimePerMessage.toFixed(3)}ms`
    );
  });
  
  console.log('─'.repeat(60));
  
  // Performance analysis
  const smallest = results[0];
  const largest = results[results.length - 1];
  const scalingFactor = largest.throughput / smallest.throughput;
  
  console.log(`\n📈 Performance Analysis:`);
  console.log(`   Scaling from ${smallest.messageCount} to ${largest.messageCount} messages:`);
  console.log(`   Throughput scaling factor: ${scalingFactor.toFixed(2)}x`);
  
  if (scalingFactor > 0.8) {
    console.log(`   ✅ Excellent scaling - performance maintained at scale`);
  } else if (scalingFactor > 0.5) {
    console.log(`   ⚠️  Good scaling - some performance degradation at scale`);
  } else {
    console.log(`   ❌ Poor scaling - significant performance degradation`);
  }
  
  console.log('\n🎉 Benchmark completed successfully!');
}

try {
  await runBenchmarks();
} catch (error) {
  console.error('❌ Benchmark failed:', error.message);
  process.exit(1);
}