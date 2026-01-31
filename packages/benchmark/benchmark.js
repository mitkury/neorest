#!/usr/bin/env node

import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { performance } from 'perf_hooks';

// Simple port manager for benchmarks
let currentPort = 9000;
function getNextPort() {
  return currentPort++;
}

class Benchmark {
  constructor() {
    this.results = [];
  }

  async measure(name, fn) {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    const duration = end - start;
    let extra = '';
    if (typeof result === 'number' && name.includes('messages') && duration > 0) {
      const msgPerSec = (result / (duration / 1000)).toFixed(0);
      extra = ` (${Number(msgPerSec).toLocaleString()} msg/s)`;
    }

    this.results.push({ name, duration, result });
    console.log(`✅ ${name}: ${duration.toFixed(2)}ms${extra}`);
    return { duration, result };
  }

  printSummary() {
    console.log('\n📊 Benchmark Summary:');
    console.log('─'.repeat(50));
    this.results.forEach(({ name, duration }) => {
      console.log(`${name.padEnd(30)} ${duration.toFixed(2)}ms`);
    });
    
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);
    console.log('─'.repeat(50));
    console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  }
}

function withTimeout(promise, ms, label) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(label)), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}

async function connectClient(url) {
  const client = new Client(url, 'websocket', { reconnect: false });
  await withTimeout(client.conn.connect(), 5000, 'Connection timeout');
  return client;
}

async function benchmarkConnectionTime() {
  console.log('🔌 Benchmarking Connection Time...\n');
  const benchmark = new Benchmark();
  
  for (let i = 0; i < 3; i++) { // Reduced from 5 to 3
    const port = getNextPort();
    const server = new NodeRouter({ port });
    
    server
      .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
      .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
    
    await server.listen();
    
    await benchmark.measure(`Connection ${i + 1}`, async () => {
      const client = await connectClient(`ws://localhost:${port}`);
      client.close();
      return client;
    });
    
    await server.close();
  }
  
  benchmark.printSummary();
}

async function benchmarkMessageThroughput() {
  console.log('📨 Benchmarking Message Throughput...\n');
  const benchmark = new Benchmark();
  
  const port = getNextPort();
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  const client = await connectClient(`ws://localhost:${port}`);
  
  // Test smaller message counts
  const messageCounts = [5, 10]; // Reduced from [10, 50, 100]

  // Warmup
  await withTimeout(client.post('/echo', { message: 'warmup' }), 5000, 'Warmup timeout');
  
  for (const count of messageCounts) {
    await benchmark.measure(`${count} messages`, async () => {
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(client.post('/echo', { message: i }));
      }
      
      // Add timeout to message sending
      const results = await withTimeout(Promise.all(promises), 10000, 'Message timeout');
      return results.length;
    });
  }
  
  client.close();
  await server.close();
  
  benchmark.printSummary();
}

async function benchmarkReconnection() {
  console.log('🔄 Benchmarking Reconnection Performance...\n');
  const benchmark = new Benchmark();
  
  const port = getNextPort();
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  // Test reconnection 3 times (reduced from 5)
  for (let i = 0; i < 3; i++) {
    await benchmark.measure(`Reconnection ${i + 1}`, async () => {
      // First connection
      const client1 = await connectClient(`ws://localhost:${port}`);
      
      const secret = client1.conn.getSecret();
      
      // Simulate connection drop
      client1.conn.strategy.socket.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Reconnect with same secret
      const client2 = await connectClient(`ws://localhost:${port}?secret=${secret}`);
      
      // Verify it works
      const response = await client2.post('/echo', { test: 'reconnection' });
      
      client2.close();
      return response.data;
    });
  }
  
  await server.close();
  
  benchmark.printSummary();
}

async function benchmarkStress() {
  console.log('💪 Benchmarking Stress Test (Multiple Connections)...\n');
  const benchmark = new Benchmark();
  
  const port = getNextPort();
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  const connectionCounts = [2, 3]; // Reduced from [5, 10, 20]
  
  for (const count of connectionCounts) {
    await benchmark.measure(`${count} concurrent connections`, async () => {
      const clients = [];
      
      // Create connections with timeout
      for (let i = 0; i < count; i++) {
        const client = await connectClient(`ws://localhost:${port}`);
        clients.push(client);
      }
      
      // Send messages from all clients
      const promises = [];
      for (let i = 0; i < clients.length; i++) {
        promises.push(clients[i].post('/echo', { clientId: i, message: 'stress test' }));
      }
      
      const results = await withTimeout(Promise.all(promises), 10000, 'Message timeout');
      
      // Close all connections
      for (const client of clients) {
        client.close();
      }
      
      return results.length;
    });
  }
  
  await server.close();
  
  benchmark.printSummary();
}

async function runAllBenchmarks() {
  console.log('🚀 Running All Benchmarks...\n');
  
  await benchmarkConnectionTime();
  console.log('\n');
  
  await benchmarkMessageThroughput();
  console.log('\n');
  
  await benchmarkReconnection();
  console.log('\n');
  
  await benchmarkStress();
  
  console.log('\n🎉 All benchmarks completed!');
}

// Main execution
const command = process.argv[2] || 'all';

switch (command) {
  case 'connection':
    await benchmarkConnectionTime();
    break;
  case 'throughput':
    await benchmarkMessageThroughput();
    break;
  case 'reconnection':
    await benchmarkReconnection();
    break;
  case 'stress':
    await benchmarkStress();
    break;
  case 'all':
  default:
    await runAllBenchmarks();
    break;
}

console.log('\n📈 Benchmark completed successfully!');
process.exit(0);
