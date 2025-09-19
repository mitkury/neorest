#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

console.log('🎯 Final Realistic Neorest Performance Benchmark\n');

async function finalBenchmark(messageCount, batchSize = 10) {
  console.log(`📊 Testing ${messageCount} messages in batches of ${batchSize}...`);
  
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
  await client.conn.connect();
  const connectTime = performance.now() - connectStart;
  console.log(`🔌 Connection: ${connectTime.toFixed(2)}ms`);
  
  // Send messages in batches
  console.log(`📤 Sending ${messageCount} messages in batches of ${batchSize}...`);
  const sendStart = performance.now();
  
  for (let i = 0; i < messageCount; i += batchSize) {
    const batch = [];
    const end = Math.min(i + batchSize, messageCount);
    
    for (let j = i; j < end; j++) {
      batch.push(client.post('/echo', { message: j, timestamp: Date.now() }));
    }
    
    await Promise.all(batch);
    
    if (end % Math.max(1, Math.floor(messageCount / 10)) === 0) {
      console.log(`📤 Sent ${end}/${messageCount} messages`);
    }
  }
  
  const sendTime = performance.now() - sendStart;
  console.log(`📤 All ${messageCount} messages sent in ${sendTime.toFixed(2)}ms`);
  
  // Wait a bit to ensure all messages are processed
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const totalTime = performance.now() - connectStart;
  const serverProcessingTime = endTime - startTime;
  
  // Calculate realistic metrics
  const throughput = (messageCount / sendTime) * 1000;
  const serverThroughput = messageReceived > 0 ? (messageReceived / serverProcessingTime) * 1000 : 0;
  const avgTimePerMessage = sendTime / messageCount;
  
  console.log(`📊 Messages sent: ${messageCount}`);
  console.log(`📊 Messages received by server: ${messageReceived}`);
  console.log(`📊 Send time: ${sendTime.toFixed(2)}ms`);
  console.log(`📊 Server processing time: ${serverProcessingTime.toFixed(2)}ms`);
  console.log(`📊 Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`📊 Throughput: ${throughput.toFixed(0)} messages/second`);
  console.log(`📊 Server throughput: ${serverThroughput.toFixed(0)} messages/second`);
  console.log(`📊 Average per message: ${avgTimePerMessage.toFixed(3)}ms`);
  
  // Success rate
  const successRate = (messageReceived / messageCount) * 100;
  console.log(`📊 Success rate: ${successRate.toFixed(1)}%`);
  
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
    avgTimePerMessage,
    successRate
  };
}

async function runFinalBenchmarks() {
  const tests = [
    { count: 100, batchSize: 10 },
    { count: 1000, batchSize: 50 },
    { count: 10000, batchSize: 100 }
  ];
  const results = [];
  
  for (const test of tests) {
    console.log(`\n${'='.repeat(70)}`);
    const result = await finalBenchmark(test.count, test.batchSize);
    results.push(result);
    console.log(`\n✅ ${test.count} messages test completed`);
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('🏆 FINAL REALISTIC BENCHMARK RESULTS');
  console.log('='.repeat(70));
  console.log('Messages | Send Time | Server Time | Throughput | Success Rate');
  console.log('─'.repeat(70));
  
  results.forEach(result => {
    console.log(
      `${result.messageCount.toString().padEnd(8)} | ` +
      `${result.sendTime.toFixed(2).padEnd(9)}ms | ` +
      `${result.serverProcessingTime.toFixed(2).padEnd(10)}ms | ` +
      `${result.throughput.toFixed(0).padEnd(10)} msg/s | ` +
      `${result.successRate.toFixed(1)}%`
    );
  });
  
  console.log('─'.repeat(70));
  
  console.log('\n🎯 Realistic Performance Summary:');
  results.forEach(result => {
    console.log(`   • ${result.messageCount} messages: ${result.throughput.toFixed(0)} msg/s (${result.successRate.toFixed(1)}% success)`);
  });
  
  // Find the most reliable test (highest success rate)
  const mostReliable = results.reduce((best, current) => 
    current.successRate > best.successRate ? current : best
  );
  
  console.log(`\n🏆 Most reliable result: ${mostReliable.messageCount} messages at ${mostReliable.throughput.toFixed(0)} msg/s (${mostReliable.successRate.toFixed(1)}% success)`);
  
  console.log('\n🎉 Final benchmark completed!');
}

try {
  await runFinalBenchmarks();
} catch (error) {
  console.error('❌ Final benchmark failed:', error.message);
  process.exit(1);
}