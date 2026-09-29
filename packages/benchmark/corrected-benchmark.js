#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('✅ Corrected Neorest Performance Benchmark\n');

async function correctedBenchmark(messageCount) {
  console.log(`📊 Testing ${messageCount} messages (ensuring all are processed)...`);
  
  const port = 9000;
  const server = new NodeRouter({ port });
  
  let messageReceived = 0;
  let startTime = 0;
  let endTime = 0;
  
  server
    .onPost('/echo', async (ctx) => { 
      messageReceived++;
      if (messageReceived === 1) {
        startTime = performance.now();
      }
      if (messageReceived === messageCount) {
        endTime = performance.now();
      }
      ctx.response = ctx.data; 
    });
  
  await server.listen();
  console.log('✅ Neorest server started');
  
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  // Connection
  const connectStart = performance.now();
  await client.connect();
  const connectTime = performance.now() - connectStart;
  console.log(`🔌 Connection: ${connectTime.toFixed(2)}ms`);
  
  // Send messages one by one to ensure they're all processed
  console.log(`📤 Sending ${messageCount} messages sequentially...`);
  const sendStart = performance.now();
  
  for (let i = 0; i < messageCount; i++) {
    await client.post('/echo', { message: i, timestamp: Date.now() });
    if ((i + 1) % Math.max(1, Math.floor(messageCount / 10)) === 0) {
      console.log(`📤 Sent ${i + 1}/${messageCount} messages`);
    }
  }
  
  const sendTime = performance.now() - sendStart;
  console.log(`📤 All ${messageCount} messages sent in ${sendTime.toFixed(2)}ms`);
  
  // Wait a bit to ensure all messages are processed
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const totalTime = performance.now() - connectStart;
  const serverProcessingTime = endTime - startTime;
  
  // Calculate realistic metrics
  const throughput = (messageCount / sendTime) * 1000;
  const serverThroughput = (messageCount / serverProcessingTime) * 1000;
  const avgTimePerMessage = sendTime / messageCount;
  
  console.log(`📊 Messages sent: ${messageCount}`);
  console.log(`📊 Messages received by server: ${messageReceived}`);
  console.log(`📊 Send time: ${sendTime.toFixed(2)}ms`);
  console.log(`📊 Server processing time: ${serverProcessingTime.toFixed(2)}ms`);
  console.log(`📊 Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`📊 Throughput: ${throughput.toFixed(0)} messages/second`);
  console.log(`📊 Server throughput: ${serverThroughput.toFixed(0)} messages/second`);
  console.log(`📊 Average per message: ${avgTimePerMessage.toFixed(3)}ms`);
  
  await client.close();
  await server.close();
  
  return {
    messageCount,
    messageReceived,
    connectTime,
    sendTime,
    serverProcessingTime,
    totalTime,
    throughput,
    serverThroughput,
    avgTimePerMessage
  };
}

async function runCorrectedBenchmarks() {
  const testSizes = [100, 1000];
  const results = [];
  
  for (const size of testSizes) {
    console.log(`\n${'='.repeat(70)}`);
    const result = await correctedBenchmark(size);
    results.push(result);
    console.log(`\n✅ ${size} messages test completed`);
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('🏆 CORRECTED BENCHMARK RESULTS');
  console.log('='.repeat(70));
  console.log('Messages | Send Time | Server Time | Throughput | Avg/Message');
  console.log('─'.repeat(70));
  
  results.forEach(result => {
    console.log(
      `${result.messageCount.toString().padEnd(8)} | ` +
      `${result.sendTime.toFixed(2).padEnd(9)}ms | ` +
      `${result.serverProcessingTime.toFixed(2).padEnd(10)}ms | ` +
      `${result.throughput.toFixed(0).padEnd(10)} msg/s | ` +
      `${result.avgTimePerMessage.toFixed(3)}ms`
    );
  });
  
  console.log('─'.repeat(70));
  
  console.log('\n🎯 Realistic Performance Summary:');
  console.log(`   • 100 messages: ${results[0].throughput.toFixed(0)} msg/s (${results[0].avgTimePerMessage.toFixed(3)}ms each)`);
  console.log(`   • 1000 messages: ${results[1].throughput.toFixed(0)} msg/s (${results[1].avgTimePerMessage.toFixed(3)}ms each)`);
  
  const scalingFactor = results[1].throughput / results[0].throughput;
  console.log(`   • Scaling factor: ${scalingFactor.toFixed(2)}x`);
  
  if (scalingFactor > 0.8) {
    console.log(`   ✅ Excellent scaling performance`);
  } else if (scalingFactor > 0.5) {
    console.log(`   ⚠️  Good scaling with some degradation`);
  } else {
    console.log(`   ❌ Poor scaling performance`);
  }
  
  console.log('\n🎉 Corrected benchmark completed!');
}

try {
  await runCorrectedBenchmarks();
} catch (error) {
  console.error('❌ Corrected benchmark failed:', error.message);
  process.exit(1);
}