import { NodeRouter } from '../../neorest/src/node';
import { Client } from '../../neorest/src';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { MemoryTestConfig, BenchmarkResult } from './types';
import { 
  PerformanceTimer, 
  getMemoryUsage, 
  generateRandomData, 
  formatBytes,
  sleep 
} from './utils';

export class NeorestMemoryTest {
  private server: NodeRouter | null = null;
  private serverPort: number = 0;
  private memorySnapshots: Array<{
    iteration: number;
    memory: ReturnType<typeof getMemoryUsage>;
    timestamp: string;
  }> = [];

  constructor(private config: MemoryTestConfig) {}

  async setup(): Promise<void> {
    console.log(chalk.blue('🔧 Setting up Neorest memory test server...'));
    
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
      .onPost('/memory-test', async (ctx) => {
        // Simulate processing with some memory allocation
        const response = {
          received: ctx.data,
          processed: true,
          timestamp: Date.now(),
          serverMemory: getMemoryUsage()
        };
        ctx.response = response;
      });

    await this.server.listen();
    console.log(chalk.green(`✅ Server running on port ${this.serverPort}`));
  }

  async run(): Promise<void> {
    console.log(chalk.yellow('🧠 Starting Neorest memory leak test...'));
    console.log(chalk.gray(`Configuration: ${JSON.stringify(this.config, null, 2)}`));

    // Take initial memory snapshot
    this.memorySnapshots.push({
      iteration: 0,
      memory: getMemoryUsage(),
      timestamp: new Date().toISOString()
    });

    // Create progress bar
    const progressBar = new cliProgress.SingleBar({
      format: 'Memory Test |{bar}| {percentage}% | {value}/{total} iterations | Memory: {memory}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(this.config.iterations, 0, { memory: formatBytes(getMemoryUsage().heapUsed * 1024 * 1024) });

    try {
      for (let iteration = 1; iteration <= this.config.iterations; iteration++) {
        const iterationStartMemory = getMemoryUsage();
        
        // Create connections for this iteration
        const connections: Client[] = [];
        
        for (let i = 0; i < this.config.connectionsPerIteration; i++) {
          try {
            const client = new Client(`ws://localhost:${this.serverPort}`, 'websocket');
            await (client as any).conn.connect();
            connections.push(client);
          } catch (error) {
            console.error(chalk.red(`❌ Failed to create connection in iteration ${iteration}:`, error));
          }
        }

        // Send messages through connections
        for (const client of connections) {
          try {
            const testData = generateRandomData(512); // Smaller data for memory test
            await client.post('/memory-test', testData);
          } catch (error) {
            // Ignore message errors for memory test
          }
        }

        // Close all connections
        for (const client of connections) {
          try {
            (client as any).close();
          } catch (error) {
            // Ignore cleanup errors
          }
        }

        // Take memory snapshot
        const iterationEndMemory = getMemoryUsage();
        this.memorySnapshots.push({
          iteration,
          memory: iterationEndMemory,
          timestamp: new Date().toISOString()
        });

        // Update progress bar
        progressBar.update(iteration, { 
          memory: formatBytes(iterationEndMemory.heapUsed * 1024 * 1024) 
        });

        // Force garbage collection if enabled
        if (this.config.gcBetweenIterations && global.gc) {
          global.gc();
        }

        // Wait between iterations
        if (this.config.delayBetweenIterations > 0) {
          await sleep(this.config.delayBetweenIterations);
        }
      }

    } finally {
      progressBar.stop();
    }

    this.analyzeMemoryLeaks();
  }

  private analyzeMemoryLeaks(): void {
    console.log(chalk.cyan('\n🧠 MEMORY LEAK ANALYSIS'));
    console.log(chalk.cyan('='.repeat(50)));

    if (this.memorySnapshots.length < 2) {
      console.log(chalk.red('❌ Not enough memory snapshots for analysis'));
      return;
    }

    const initialMemory = this.memorySnapshots[0].memory;
    const finalMemory = this.memorySnapshots[this.memorySnapshots.length - 1].memory;

    console.log(chalk.white('Memory Usage Summary:'));
    console.log(`  Initial Heap Used: ${chalk.yellow(formatBytes(initialMemory.heapUsed * 1024 * 1024))}`);
    console.log(`  Final Heap Used: ${chalk.yellow(formatBytes(finalMemory.heapUsed * 1024 * 1024))}`);
    console.log(`  Memory Growth: ${chalk.yellow(formatBytes((finalMemory.heapUsed - initialMemory.heapUsed) * 1024 * 1024))}`);

    // Calculate growth rate
    const totalGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
    const growthRate = totalGrowth / this.config.iterations;

    console.log(`  Growth Rate: ${chalk.yellow(formatBytes(growthRate * 1024 * 1024))} per iteration`);

    // Analyze memory leak patterns
    const memoryGrowth = this.memorySnapshots.map((snapshot, index) => {
      if (index === 0) return 0;
      return snapshot.memory.heapUsed - this.memorySnapshots[index - 1].memory.heapUsed;
    }).slice(1);

    const positiveGrowth = memoryGrowth.filter(growth => growth > 0);
    const negativeGrowth = memoryGrowth.filter(growth => growth < 0);
    const stableGrowth = memoryGrowth.filter(growth => growth === 0);

    console.log(chalk.white('\nMemory Growth Pattern:'));
    console.log(`  Iterations with growth: ${chalk.red(positiveGrowth.length)}`);
    console.log(`  Iterations with reduction: ${chalk.green(negativeGrowth.length)}`);
    console.log(`  Stable iterations: ${chalk.blue(stableGrowth.length)}`);

    // Detect memory leak
    const memoryLeakThreshold = 10; // MB
    const isMemoryLeak = totalGrowth > memoryLeakThreshold;

    console.log(chalk.white('\nMemory Leak Detection:'));
    if (isMemoryLeak) {
      console.log(chalk.red(`  ⚠️  MEMORY LEAK DETECTED!`));
      console.log(chalk.red(`  Total growth: ${formatBytes(totalGrowth * 1024 * 1024)}`));
      console.log(chalk.red(`  Growth rate: ${formatBytes(growthRate * 1024 * 1024)} per iteration`));
      
      // Show worst iterations
      const worstIterations = memoryGrowth
        .map((growth, index) => ({ growth, iteration: index + 1 }))
        .sort((a, b) => b.growth - a.growth)
        .slice(0, 5);

      console.log(chalk.red('\n  Worst memory growth iterations:'));
      worstIterations.forEach(({ growth, iteration }) => {
        console.log(chalk.red(`    Iteration ${iteration}: +${formatBytes(growth * 1024 * 1024)}`));
      });
    } else {
      console.log(chalk.green(`  ✅ No significant memory leak detected`));
      console.log(chalk.green(`  Total growth: ${formatBytes(totalGrowth * 1024 * 1024)}`));
    }

    // Show memory trend
    console.log(chalk.white('\nMemory Trend:'));
    const trend = this.calculateTrend(memoryGrowth);
    if (trend > 0.1) {
      console.log(chalk.red(`  📈 Upward trend detected (${trend.toFixed(2)} MB/iteration)`));
    } else if (trend < -0.1) {
      console.log(chalk.green(`  📉 Downward trend detected (${trend.toFixed(2)} MB/iteration)`));
    } else {
      console.log(chalk.blue(`  ➡️  Stable memory usage (${trend.toFixed(2)} MB/iteration)`));
    }
  }

  private calculateTrend(values: number[]): number {
    if (values.length === 0) return 0;
    
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, val, index) => sum + val * index, 0);
    const sumX2 = values.reduce((sum, _, index) => sum + index * index, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  async cleanup(): Promise<void> {
    console.log(chalk.blue('🧹 Cleaning up memory test...'));
    
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
}

// Default configuration
const defaultConfig: MemoryTestConfig = {
  iterations: 50,
  connectionsPerIteration: 10,
  delayBetweenIterations: 100,
  gcBetweenIterations: true
};

// Run memory test if called directly
if (require.main === module) {
  (async () => {
    const config = { ...defaultConfig };
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    for (const arg of args) {
      if (arg.startsWith('--iterations=')) {
        config.iterations = parseInt(arg.split('=')[1]);
      } else if (arg.startsWith('--connections=')) {
        config.connectionsPerIteration = parseInt(arg.split('=')[1]);
      } else if (arg.startsWith('--delay=')) {
        config.delayBetweenIterations = parseInt(arg.split('=')[1]);
      } else if (arg === '--no-gc') {
        config.gcBetweenIterations = false;
      }
    }

    const memoryTest = new NeorestMemoryTest(config);
    
    try {
      await memoryTest.setup();
      await memoryTest.run();
    } catch (error) {
      console.error(chalk.red('❌ Memory test failed:', error));
      process.exit(1);
    } finally {
      await memoryTest.cleanup();
    }
  })();
}