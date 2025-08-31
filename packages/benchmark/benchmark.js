#!/usr/bin/env node

const { NodeRouter } = require('../neorest/dist/node.cjs');
const { Client } = require('../neorest/dist/index.cjs');
const chalk = require('chalk');

class NeorestBenchmark {
  constructor() {
    this.server = null;
    this.serverPort = 0;
    this.results = [];
  }

  async findAvailablePort() {
    const net = require('net');
    
    for (let port = 8000; port < 9000; port++) {
      try {
        await new Promise((resolve, reject) => {
          const server = net.createServer();
          server.listen(port, () => {
            server.close();
            resolve(port);
          });
          server.on('error', reject);
        });
        return port;
      } catch {
        // Port in use, try next
      }
    }
    
    throw new Error('No available ports found');
  }

  async setup() {
    console.log(chalk.blue('🔧 Setting up Neorest benchmark server...'));
    
    this.serverPort = await this.findAvailablePort();
    
    this.server = new NodeRouter({ port: this.serverPort });
    
    this.server
      .onGet('/ping', async (ctx) => {
        ctx.response = 'pong';
      })
      .onPost('/echo', async (ctx) => {
        ctx.response = ctx.data;
      })
      .onPost('/benchmark', async (ctx) => {
        ctx.response = {
          received: ctx.data,
          processed: true,
          timestamp: Date.now()
        };
      });

    await this.server.listen();
    console.log(chalk.green(`✅ Server running on port ${this.serverPort}`));
  }

  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
    };
  }

  generateRandomData(size) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < size; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return {
      id: Math.random().toString(36).substring(2, 15),
      data: result,
      timestamp: Date.now(),
      metadata: {
        size,
        generated: new Date().toISOString(),
      }
    };
  }

  async runStressTest(connections = 50, messagesPerConnection = 20, messageSize = 1024) {
    console.log(chalk.yellow('🔥 Running Stress Test...'));
    console.log(chalk.gray(`Configuration: ${connections} connections, ${messagesPerConnection} messages each, ${messageSize} bytes per message`));

    const startTime = Date.now();
    const initialMemory = this.getMemoryUsage();
    
    console.log(chalk.blue(`Initial memory: ${initialMemory.heapUsed}MB heap, ${initialMemory.rss}MB RSS`));

    const clientConnections = [];
    let successfulConnections = 0;
    let failedConnections = 0;
    let totalMessages = 0;
    let successfulMessages = 0;
    const responseTimes = [];

    // Create connections
    console.log(chalk.blue('Creating connections...'));
    for (let i = 0; i < connections; i++) {
      try {
        const client = new Client(`ws://localhost:${this.serverPort}`, 'websocket');
        await client.conn.connect();
        clientConnections.push(client);
        successfulConnections++;
        
        if (i % 10 === 0) {
          console.log(chalk.gray(`Created ${i + 1}/${connections} connections`));
        }
      } catch (error) {
        failedConnections++;
        console.error(chalk.red(`❌ Failed to create connection ${i}:`, error.message));
      }
    }

    console.log(chalk.green(`✅ Created ${successfulConnections} connections successfully`));

    // Send messages
    console.log(chalk.blue('Sending messages...'));
    const messagePromises = [];
    
    for (const client of clientConnections) {
      for (let j = 0; j < messagesPerConnection; j++) {
        const messagePromise = this.sendMessage(client, j, messageSize, responseTimes);
        messagePromises.push(messagePromise);
        totalMessages++;
      }
    }

    await Promise.allSettled(messagePromises);

    // Calculate metrics
    const endTime = Date.now();
    const duration = endTime - startTime;
    const finalMemory = this.getMemoryUsage();
    const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;

    console.log(chalk.cyan('\n📊 STRESS TEST RESULTS'));
    console.log(chalk.cyan('='.repeat(50)));
    
    console.log(chalk.white('Connections:'));
    console.log(`  Total: ${chalk.yellow(connections)}`);
    console.log(`  Successful: ${chalk.green(successfulConnections)}`);
    console.log(`  Failed: ${chalk.red(failedConnections)}`);
    console.log(`  Success Rate: ${chalk.blue(((successfulConnections / connections) * 100).toFixed(2))}%`);
    
    console.log(chalk.white('\nMessages:'));
    console.log(`  Total: ${chalk.yellow(totalMessages)}`);
    console.log(`  Successful: ${chalk.green(successfulMessages)}`);
    console.log(`  Failed: ${chalk.red(totalMessages - successfulMessages)}`);
    console.log(`  Success Rate: ${chalk.blue(((successfulMessages / totalMessages) * 100).toFixed(2))}%`);
    
    console.log(chalk.white('\nPerformance:'));
    console.log(`  Duration: ${chalk.yellow((duration / 1000).toFixed(2))}s`);
    console.log(`  Messages per second: ${chalk.yellow((totalMessages / (duration / 1000)).toFixed(2))}`);
    
    if (responseTimes.length > 0) {
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const minResponseTime = Math.min(...responseTimes);
      const maxResponseTime = Math.max(...responseTimes);
      
      console.log(`  Average Response Time: ${chalk.yellow(avgResponseTime.toFixed(2))}ms`);
      console.log(`  Min Response Time: ${chalk.green(minResponseTime.toFixed(2))}ms`);
      console.log(`  Max Response Time: ${chalk.red(maxResponseTime.toFixed(2))}ms`);
    }
    
    console.log(chalk.white('\nMemory:'));
    console.log(`  Initial Heap: ${chalk.yellow(initialMemory.heapUsed)}MB`);
    console.log(`  Final Heap: ${chalk.yellow(finalMemory.heapUsed)}MB`);
    console.log(`  Memory Growth: ${chalk.yellow(memoryGrowth)}MB`);
    console.log(`  Memory Leak: ${memoryGrowth > 50 ? chalk.red('YES') : chalk.green('NO')}`);

    // Cleanup
    console.log(chalk.blue('\n🧹 Cleaning up connections...'));
    for (const client of clientConnections) {
      try {
        client.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    return {
      connections: { total: connections, successful: successfulConnections, failed: failedConnections },
      messages: { total: totalMessages, successful: successfulMessages, failed: totalMessages - successfulMessages },
      performance: { duration, messagesPerSecond: totalMessages / (duration / 1000) },
      memory: { initial: initialMemory, final: finalMemory, growth: memoryGrowth, leak: memoryGrowth > 50 }
    };
  }

  async sendMessage(client, messageIndex, messageSize, responseTimes) {
    const startTime = Date.now();
    
    try {
      const testData = this.generateRandomData(messageSize);
      const response = await client.post('/benchmark', testData);
      
      const endTime = Date.now();
      responseTimes.push(endTime - startTime);
      
      // Verify response
      if (response.data && response.data.processed) {
        // Message successful
      } else {
        throw new Error('Invalid response');
      }
    } catch (error) {
      // Message failed
      console.error(chalk.red(`❌ Message ${messageIndex} failed:`, error.message));
    }
  }

  async runMemoryTest(iterations = 30, connectionsPerIteration = 10) {
    console.log(chalk.yellow('\n🧠 Running Memory Leak Test...'));
    console.log(chalk.gray(`Configuration: ${iterations} iterations, ${connectionsPerIteration} connections per iteration`));

    const memorySnapshots = [];
    
    // Take initial snapshot
    memorySnapshots.push({
      iteration: 0,
      memory: this.getMemoryUsage(),
      timestamp: new Date().toISOString()
    });

    for (let iteration = 1; iteration <= iterations; iteration++) {
      const connections = [];
      
      // Create connections for this iteration
      for (let i = 0; i < connectionsPerIteration; i++) {
        try {
          const client = new Client(`ws://localhost:${this.serverPort}`, 'websocket');
          await client.conn.connect();
          connections.push(client);
        } catch (error) {
          console.error(chalk.red(`❌ Failed to create connection in iteration ${iteration}:`, error.message));
        }
      }

      // Send messages through connections
      for (const client of connections) {
        try {
          const testData = this.generateRandomData(512);
          await client.post('/benchmark', testData);
        } catch (error) {
          // Ignore message errors for memory test
        }
      }

      // Close all connections
      for (const client of connections) {
        try {
          client.close();
        } catch (error) {
          // Ignore cleanup errors
        }
      }

      // Take memory snapshot
      const memory = this.getMemoryUsage();
      memorySnapshots.push({
        iteration,
        memory,
        timestamp: new Date().toISOString()
      });

      if (iteration % 5 === 0) {
        console.log(chalk.gray(`Iteration ${iteration}/${iterations}: ${memory.heapUsed}MB heap`));
      }

      // Small delay between iterations
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Analyze memory leaks
    this.analyzeMemoryLeaks(memorySnapshots);
  }

  analyzeMemoryLeaks(memorySnapshots) {
    console.log(chalk.cyan('\n🧠 MEMORY LEAK ANALYSIS'));
    console.log(chalk.cyan('='.repeat(50)));

    if (memorySnapshots.length < 2) {
      console.log(chalk.red('❌ Not enough memory snapshots for analysis'));
      return;
    }

    const initialMemory = memorySnapshots[0].memory;
    const finalMemory = memorySnapshots[memorySnapshots.length - 1].memory;

    console.log(chalk.white('Memory Usage Summary:'));
    console.log(`  Initial Heap: ${chalk.yellow(initialMemory.heapUsed)}MB`);
    console.log(`  Final Heap: ${chalk.yellow(finalMemory.heapUsed)}MB`);
    console.log(`  Memory Growth: ${chalk.yellow(finalMemory.heapUsed - initialMemory.heapUsed)}MB`);

    const totalGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
    const growthRate = totalGrowth / (memorySnapshots.length - 1);

    console.log(`  Growth Rate: ${chalk.yellow(growthRate.toFixed(2))}MB per iteration`);

    // Detect memory leak
    const memoryLeakThreshold = 10; // MB
    const isMemoryLeak = totalGrowth > memoryLeakThreshold;

    console.log(chalk.white('\nMemory Leak Detection:'));
    if (isMemoryLeak) {
      console.log(chalk.red(`  ⚠️  MEMORY LEAK DETECTED!`));
      console.log(chalk.red(`  Total growth: ${totalGrowth}MB`));
      console.log(chalk.red(`  Growth rate: ${growthRate.toFixed(2)}MB per iteration`));
    } else {
      console.log(chalk.green(`  ✅ No significant memory leak detected`));
      console.log(chalk.green(`  Total growth: ${totalGrowth}MB`));
    }
  }

  async cleanup() {
    console.log(chalk.blue('🧹 Cleaning up benchmark...'));
    
    if (this.server) {
      try {
        await this.server.close();
        console.log(chalk.green('✅ Server stopped'));
      } catch (error) {
        console.error(chalk.red('❌ Error stopping server:', error));
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node benchmark.js [options]

Commands:
  stress                    Run stress test only
  memory                    Run memory leak test only
  full                      Run full benchmark suite (default)

Options:
  --connections=N          Number of concurrent connections (default: 50)
  --messages=N             Messages per connection (default: 20)
  --size=N                 Message size in bytes (default: 1024)
  --iterations=N           Number of iterations for memory test (default: 30)
  --connections-per-iter=N Connections per iteration for memory test (default: 10)

Examples:
  node benchmark.js stress --connections=100 --messages=50
  node benchmark.js memory --iterations=50 --connections-per-iter=20
  node benchmark.js full
`);
    return;
  }

  const benchmark = new NeorestBenchmark();
  
  try {
    await benchmark.setup();
    
    const command = args[0] || 'full';
    
    switch (command) {
      case 'stress':
        const connections = parseInt(args.find(arg => arg.startsWith('--connections='))?.split('=')[1]) || 50;
        const messages = parseInt(args.find(arg => arg.startsWith('--messages='))?.split('=')[1]) || 20;
        const size = parseInt(args.find(arg => arg.startsWith('--size='))?.split('=')[1]) || 1024;
        
        await benchmark.runStressTest(connections, messages, size);
        break;
        
      case 'memory':
        const iterations = parseInt(args.find(arg => arg.startsWith('--iterations='))?.split('=')[1]) || 30;
        const connectionsPerIter = parseInt(args.find(arg => arg.startsWith('--connections-per-iter='))?.split('=')[1]) || 10;
        
        await benchmark.runMemoryTest(iterations, connectionsPerIter);
        break;
        
      case 'full':
        console.log(chalk.yellow('📊 Running Full Benchmark Suite...'));
        await benchmark.runStressTest(25, 10, 1024);
        console.log(chalk.blue('\n⏳ Waiting 3 seconds between tests...'));
        await new Promise(resolve => setTimeout(resolve, 3000));
        await benchmark.runMemoryTest(20, 5);
        break;
        
      default:
        console.error(chalk.red(`❌ Unknown command: ${command}`));
        process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Benchmark failed:', error));
    process.exit(1);
  } finally {
    await benchmark.cleanup();
  }
}

if (require.main === module) {
  main();
}