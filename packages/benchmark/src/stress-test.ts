import { NodeRouter } from '../../neorest/src/node';
import { Client } from '../../neorest/src';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { 
  StressTestConfig, 
  BenchmarkResult, 
  TestMetrics 
} from './types';
import { 
  PerformanceTimer, 
  getMemoryUsage, 
  generateRandomData, 
  calculateMetrics, 
  formatDuration, 
  formatBytes,
  sleep 
} from './utils';

export class NeorestStressTest {
  private server: NodeRouter | null = null;
  private serverPort: number = 0;
  private results: BenchmarkResult[] = [];
  private responseTimes: number[] = [];

  constructor(private config: StressTestConfig) {}

  async setup(): Promise<void> {
    console.log(chalk.blue('🔧 Setting up Neorest stress test server...'));
    
    // Find available port
    this.serverPort = await this.findAvailablePort();
    
    // Create server
    this.server = new NodeRouter({ port: this.serverPort });
    
    // Add test endpoints
    this.server
      .onGet('/ping', async (ctx) => {
        ctx.response = 'pong';
      })
      .onPost('/echo', async (ctx) => {
        ctx.response = ctx.data;
      })
      .onPost('/stress', async (ctx) => {
        // Simulate some processing time
        await sleep(Math.random() * 10);
        ctx.response = {
          received: ctx.data,
          processed: true,
          timestamp: Date.now()
        };
      });

    await this.server.listen();
    console.log(chalk.green(`✅ Server running on port ${this.serverPort}`));
  }

  async run(): Promise<TestMetrics> {
    console.log(chalk.yellow('🚀 Starting Neorest stress test...'));
    console.log(chalk.gray(`Configuration: ${JSON.stringify(this.config, null, 2)}`));

    const timer = new PerformanceTimer();
    timer.start();

    const initialMemory = getMemoryUsage();
    this.results.push({
      name: 'initial',
      duration: 0,
      operations: 0,
      opsPerSecond: 0,
      memoryUsage: initialMemory,
      errors: 0,
      timestamp: new Date().toISOString()
    });

    const connections: Client[] = [];
    let successfulConnections = 0;
    let failedConnections = 0;
    let totalMessages = 0;
    let successfulMessages = 0;

    // Create progress bar
    const progressBar = new cliProgress.SingleBar({
      format: 'Stress Test |{bar}| {percentage}% | {value}/{total} connections | ETA: {eta}s | {connections} active',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(this.config.connections, 0);

    try {
      // Create connections
      for (let i = 0; i < this.config.connections; i++) {
        try {
          const client = new Client(`ws://localhost:${this.serverPort}`, 'websocket');
          await (client as any).conn.connect();
          connections.push(client);
          successfulConnections++;
          
          progressBar.update(i + 1, { connections: connections.length });
          
          // Add small delay to prevent overwhelming the server
          if (i % 10 === 0) {
            await sleep(10);
          }
        } catch (error) {
          failedConnections++;
          console.error(chalk.red(`❌ Failed to create connection ${i}:`, error));
        }
      }

      console.log(chalk.green(`\n✅ Created ${successfulConnections} connections successfully`));

      // Send messages through all connections
      const messagePromises: Promise<void>[] = [];
      
      for (const client of connections) {
        for (let j = 0; j < this.config.messagesPerConnection; j++) {
          const messagePromise = this.sendMessage(client, j);
          messagePromises.push(messagePromise);
          totalMessages++;
        }
      }

      // Wait for all messages to complete
      await Promise.allSettled(messagePromises);

      // Record final metrics
      const finalMemory = getMemoryUsage();
      const duration = timer.stop();

      this.results.push({
        name: 'final',
        duration,
        operations: totalMessages,
        opsPerSecond: totalMessages / (duration / 1000),
        memoryUsage: finalMemory,
        errors: failedConnections + (totalMessages - successfulMessages),
        timestamp: new Date().toISOString()
      });

      // Calculate metrics
      const metrics = calculateMetrics(
        this.results,
        this.config.connections,
        successfulConnections,
        totalMessages,
        successfulMessages,
        this.responseTimes
      );

      return metrics;

    } finally {
      progressBar.stop();
      
      // Cleanup connections
      console.log(chalk.blue('🧹 Cleaning up connections...'));
      for (const client of connections) {
        try {
          (client as any).close();
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }
  }

  private async sendMessage(client: Client, messageIndex: number): Promise<void> {
    const startTime = performance.now();
    
    try {
      const testData = generateRandomData(this.config.messageSize);
      const response = await client.post('/stress', testData);
      
      const endTime = performance.now();
      this.responseTimes.push(endTime - startTime);
      
      // Verify response
      if (response.data && response.data.processed) {
        // Message successful
      } else {
        throw new Error('Invalid response');
      }
    } catch (error) {
      // Message failed
      console.error(chalk.red(`❌ Message ${messageIndex} failed:`, error));
    }
  }

  async cleanup(): Promise<void> {
    console.log(chalk.blue('🧹 Cleaning up stress test...'));
    
    if (this.server) {
      try {
        await this.server.close();
        console.log(chalk.green('✅ Server stopped'));
      } catch (error) {
        console.error(chalk.red('❌ Error stopping server:', error));
      }
    }
  }

  private async findAvailablePort(): Promise<number> {
    // Simple port finder - in production you might want a more robust solution
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

  printResults(metrics: TestMetrics): void {
    console.log(chalk.cyan('\n📊 STRESS TEST RESULTS'));
    console.log(chalk.cyan('='.repeat(50)));
    
    console.log(chalk.white(`Connections:`));
    console.log(`  Total: ${chalk.yellow(metrics.totalConnections)}`);
    console.log(`  Successful: ${chalk.green(metrics.successfulConnections)}`);
    console.log(`  Failed: ${chalk.red(metrics.failedConnections)}`);
    console.log(`  Success Rate: ${chalk.blue(((metrics.successfulConnections / metrics.totalConnections) * 100).toFixed(2))}%`);
    
    console.log(chalk.white(`\nMessages:`));
    console.log(`  Total: ${chalk.yellow(metrics.totalMessages)}`);
    console.log(`  Successful: ${chalk.green(metrics.successfulMessages)}`);
    console.log(`  Failed: ${chalk.red(metrics.failedMessages)}`);
    console.log(`  Success Rate: ${chalk.blue(((metrics.successfulMessages / metrics.totalMessages) * 100).toFixed(2))}%`);
    
    console.log(chalk.white(`\nPerformance:`));
    console.log(`  Average Response Time: ${chalk.yellow(formatDuration(metrics.averageResponseTime))}`);
    console.log(`  Min Response Time: ${chalk.green(formatDuration(metrics.minResponseTime))}`);
    console.log(`  Max Response Time: ${chalk.red(formatDuration(metrics.maxResponseTime))}`);
    
    console.log(chalk.white(`\nMemory:`));
    const finalMemory = this.results[this.results.length - 1]?.memoryUsage;
    if (finalMemory) {
      console.log(`  Heap Used: ${chalk.yellow(formatBytes(finalMemory.heapUsed * 1024 * 1024))}`);
      console.log(`  Heap Total: ${chalk.yellow(formatBytes(finalMemory.heapTotal * 1024 * 1024))}`);
      console.log(`  RSS: ${chalk.yellow(formatBytes(finalMemory.rss * 1024 * 1024))}`);
    }
    
    console.log(`  Memory Growth: ${chalk.yellow(formatBytes(metrics.memoryGrowth * 1024 * 1024))}`);
    console.log(`  Memory Leak Detected: ${metrics.memoryLeakDetected ? chalk.red('YES') : chalk.green('NO')}`);
    
    if (metrics.memoryLeakDetected) {
      console.log(chalk.red('\n⚠️  WARNING: Memory leak detected!'));
    }
  }
}

// Default configuration
const defaultConfig: StressTestConfig = {
  connections: 100,
  messagesPerConnection: 10,
  messageSize: 1024,
  duration: 30000,
  concurrentConnections: true
};

// Run stress test if called directly
if (require.main === module) {
  (async () => {
    const config = { ...defaultConfig };
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    for (const arg of args) {
      if (arg.startsWith('--connections=')) {
        config.connections = parseInt(arg.split('=')[1]);
      } else if (arg.startsWith('--messages=')) {
        config.messagesPerConnection = parseInt(arg.split('=')[1]);
      } else if (arg.startsWith('--size=')) {
        config.messageSize = parseInt(arg.split('=')[1]);
      }
    }

    const stressTest = new NeorestStressTest(config);
    
    try {
      await stressTest.setup();
      const metrics = await stressTest.run();
      stressTest.printResults(metrics);
    } catch (error) {
      console.error(chalk.red('❌ Stress test failed:', error));
      process.exit(1);
    } finally {
      await stressTest.cleanup();
    }
  })();
}