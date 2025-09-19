#!/usr/bin/env node

import { performance } from 'perf_hooks';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as SocketIOClient } from 'socket.io-client';

console.log('🔍 Socket.IO vs NeoRest Performance Comparison\n');

async function socketIOTest(messageCount) {
  console.log(`📊 Testing Socket.IO with ${messageCount} messages...`);
  
  // Create Socket.IO server
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" }
  });
  
  let messageReceived = 0;
  let startTime = 0;
  
  io.on('connection', (socket) => {
    socket.on('echo', (data, callback) => {
      messageReceived++;
      if (messageReceived === 1) {
        startTime = performance.now();
      }
      if (messageReceived % 100 === 0) {
        console.log(`📨 ${messageReceived} messages received`);
      }
      callback(data);
    });
  });
  
  // Start server
  await new Promise((resolve) => {
    httpServer.listen(9001, resolve);
  });
  console.log('✅ Socket.IO server started on port 9001');
  
  // Create client
  const client = SocketIOClient('http://localhost:9001');
  
  // Wait for connection
  await new Promise((resolve) => {
    client.on('connect', resolve);
  });
  console.log('✅ Socket.IO client connected');
  
  // Send messages
  const sendStart = performance.now();
  const promises = [];
  
  for (let i = 0; i < messageCount; i++) {
    const promise = new Promise((resolve) => {
      client.emit('echo', { message: i, timestamp: Date.now() }, resolve);
    });
    promises.push(promise);
  }
  
  const sendTime = performance.now() - sendStart;
  console.log(`📤 All ${messageCount} messages sent in ${sendTime.toFixed(2)}ms`);
  
  // Wait for responses
  const responseStart = performance.now();
  const responses = await Promise.all(promises);
  const responseTime = performance.now() - responseStart;
  
  const totalTime = performance.now() - sendStart;
  const throughput = (messageCount / totalTime) * 1000;
  
  console.log(`📥 All responses received in ${responseTime.toFixed(2)}ms`);
  console.log(`📊 Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`📊 Throughput: ${throughput.toFixed(0)} messages/second`);
  
  // Cleanup
  client.disconnect();
  httpServer.close();
  
  return {
    messageCount,
    sendTime,
    responseTime,
    totalTime,
    throughput
  };
}

async function neorestTest(messageCount) {
  console.log(`\n📊 Testing NeoRest with ${messageCount} messages...`);
  
  const { NodeRouter } = await import('neorest/node');
  const { Client } = await import('neorest');
  
  const server = new NodeRouter({ port: 9000 });
  let messageReceived = 0;
  let startTime = 0;
  
  server.onPost('/echo', async (ctx) => {
    messageReceived++;
    if (messageReceived === 1) {
      startTime = performance.now();
    }
    if (messageReceived % 100 === 0) {
      console.log(`📨 ${messageReceived} messages received`);
    }
    ctx.response = ctx.data;
  });
  
  await server.listen();
  console.log('✅ NeoRest server started on port 9000');
  
  const client = new Client('ws://localhost:9000', 'websocket');
  await client.conn.connect();
  console.log('✅ NeoRest client connected');
  
  // Send messages
  const sendStart = performance.now();
  const promises = [];
  
  for (let i = 0; i < messageCount; i++) {
    promises.push(client.post('/echo', { message: i, timestamp: Date.now() }));
  }
  
  const sendTime = performance.now() - sendStart;
  console.log(`📤 All ${messageCount} messages sent in ${sendTime.toFixed(2)}ms`);
  
  // Wait for responses
  const responseStart = performance.now();
  const responses = await Promise.all(promises);
  const responseTime = performance.now() - responseStart;
  
  const totalTime = performance.now() - sendStart;
  const throughput = (messageCount / totalTime) * 1000;
  
  console.log(`📥 All responses received in ${responseTime.toFixed(2)}ms`);
  console.log(`📊 Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`📊 Throughput: ${throughput.toFixed(0)} messages/second`);
  
  // Cleanup
  await client.close();
  await server.close();
  
  return {
    messageCount,
    sendTime,
    responseTime,
    totalTime,
    throughput
  };
}

async function runComparison() {
  const messageCount = 100;
  
  try {
    const socketIOResult = await socketIOTest(messageCount);
    const neorestResult = await neorestTest(messageCount);
    
    console.log('\n🏆 PERFORMANCE COMPARISON RESULTS:');
    console.log('═'.repeat(60));
    console.log(`Test: ${messageCount} messages each`);
    console.log('─'.repeat(60));
    console.log(`Socket.IO:`);
    console.log(`  Total time:     ${socketIOResult.totalTime.toFixed(2)}ms`);
    console.log(`  Throughput:     ${socketIOResult.throughput.toFixed(0)} msg/sec`);
    console.log(`  Send time:      ${socketIOResult.sendTime.toFixed(2)}ms`);
    console.log(`  Response time:  ${socketIOResult.responseTime.toFixed(2)}ms`);
    console.log('');
    console.log(`NeoRest:`);
    console.log(`  Total time:     ${neorestResult.totalTime.toFixed(2)}ms`);
    console.log(`  Throughput:     ${neorestResult.throughput.toFixed(0)} msg/sec`);
    console.log(`  Send time:      ${neorestResult.sendTime.toFixed(2)}ms`);
    console.log(`  Response time:  ${neorestResult.responseTime.toFixed(2)}ms`);
    console.log('─'.repeat(60));
    
    const speedup = neorestResult.throughput / socketIOResult.throughput;
    const timeImprovement = socketIOResult.totalTime / neorestResult.totalTime;
    
    console.log(`📈 NeoRest is ${speedup.toFixed(2)}x faster in throughput`);
    console.log(`📈 NeoRest is ${timeImprovement.toFixed(2)}x faster in total time`);
    console.log('═'.repeat(60));
    
  } catch (error) {
    console.error('❌ Comparison failed:', error.message);
    process.exit(1);
  }
}

try {
  await runComparison();
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}