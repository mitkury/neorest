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
    
    this.results.push({ name, duration, result });
    console.log(`✅ ${name}: ${duration.toFixed(2)}ms`);
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

async function benchmarkConnectionTime() {
  console.log('🔌 Benchmarking Connection Time (Medium Load)...\n');
  const benchmark = new Benchmark();
  
  for (let i = 0; i < 5; i++) { // Increased from 3 to 5
    const port = getNextPort();
    const server = new NodeRouter({ port });
    
    server
      .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
      .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
    
    await server.listen();
    
    await benchmark.measure(`Connection ${i + 1}`, async () => {
      const client = new Client(`ws://localhost:${port}`, 'websocket');
      
      // Add timeout to prevent hanging
      const connectPromise = client.conn.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );
      
      await Promise.race([connectPromise, timeoutPromise]);
      await client.close();
      return client;
    });
    
    await server.close();
  }
  
  benchmark.printSummary();
}

async function benchmarkMessageThroughput() {
  console.log('📨 Benchmarking Message Throughput (Medium Load)...\n');
  const benchmark = new Benchmark();
  
  const port = getNextPort();
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  const client = new Client(`ws://localhost:${port}`, 'websocket');
  
  // Add timeout to connection
  const connectPromise = client.conn.connect();
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Connection timeout')), 5000)
  );
  await Promise.race([connectPromise, timeoutPromise]);
  
  // Test medium message counts
  const messageCounts = [25, 50, 100]; // Increased from [5, 10]
  
  for (const count of messageCounts) {
    await benchmark.measure(`${count} messages`, async () => {
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(client.post('/echo', { message: i }));
      }
      
      // Add timeout to message sending
      const messagePromise = Promise.all(promises);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Message timeout')), 15000)
      );
      
      const results = await Promise.race([messagePromise, timeoutPromise]);
      return results.length;
    });
  }
  
  await client.close();
  await server.close();
  
  benchmark.printSummary();
}

async function benchmarkReconnection() {
  console.log('🔄 Benchmarking Reconnection Performance (Medium Load)...\n');
  const benchmark = new Benchmark();
  
  const port = getNextPort();
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  // Test reconnection 5 times (increased from 3)
  for (let i = 0; i < 5; i++) {
    await benchmark.measure(`Reconnection ${i + 1}`, async () => {
      // First connection
      const client1 = new Client(`ws://localhost:${port}`, 'websocket');
      
      const connectPromise1 = client1.conn.connect();
      const timeoutPromise1 = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );
      await Promise.race([connectPromise1, timeoutPromise1]);
      
      const secret = client1.conn.getSecret();
      
      // Simulate connection drop
      client1.conn.strategy.socket.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Reconnect with same secret
      const client2 = new Client(`ws://localhost:${port}?secret=${secret}`, 'websocket');
      
      const connectPromise2 = client2.conn.connect();
      const timeoutPromise2 = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Reconnection timeout')), 5000)
      );
      await Promise.race([connectPromise2, timeoutPromise2]);
      
      // Verify it works
      const response = await client2.post('/echo', { test: 'reconnection' });
      
      await client2.close();
      return response.data;
    });
  }
  
  await server.close();
  
  benchmark.printSummary();
}

async function benchmarkStress() {
  console.log('💪 Benchmarking Stress Test (Medium Load)...\n');
  const benchmark = new Benchmark();
  
  const port = getNextPort();
  const server = new NodeRouter({ port });
  
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  
  await server.listen();
  
  const connectionCounts = [5, 10, 15]; // Increased from [2, 3]
  
  for (const count of connectionCounts) {
    await benchmark.measure(`${count} concurrent connections`, async () => {
      const clients = [];
      
      // Create connections with timeout
      for (let i = 0; i < count; i++) {
        const client = new Client(`ws://localhost:${port}`, 'websocket');
        
        const connectPromise = client.conn.connect();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        );
        
        await Promise.race([connectPromise, timeoutPromise]);
        clients.push(client);
      }
      
      // Send messages from all clients
      const promises = [];
      for (let i = 0; i < clients.length; i++) {
        promises.push(clients[i].post('/echo', { clientId: i, message: 'stress test' }));
      }
      
      const messagePromise = Promise.all(promises);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Message timeout')), 15000)
      );
      
      const results = await Promise.race([messagePromise, timeoutPromise]);
      
      // Close all connections
      for (const client of clients) {
        await client.close();
      }
      
      return results.length;
    });
  }
  
  await server.close();
  
  benchmark.printSummary();
}

async function runAllBenchmarks() {
  console.log('🚀 Running Medium Load Benchmarks...\n');
  
  await benchmarkConnectionTime();
  console.log('\n');
  
  await benchmarkMessageThroughput();
  console.log('\n');
  
  await benchmarkReconnection();
  console.log('\n');
  
  await benchmarkStress();
  
  console.log('\n🎉 All medium load benchmarks completed!');
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

console.log('\n📈 Medium load benchmark completed successfully!');
process.exit(0);