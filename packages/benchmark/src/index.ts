#!/usr/bin/env node

import chalk from 'chalk';
import { NeorestStressTest } from './stress-test';
import { NeorestMemoryTest } from './memory-test';
import { StressTestConfig, MemoryTestConfig } from './types';

console.log(chalk.cyan('🚀 Neorest Performance Benchmarking Suite'));
console.log(chalk.cyan('='.repeat(50)));

async function runStressTest(config: StressTestConfig): Promise<void> {
  console.log(chalk.yellow('\n🔥 Running Stress Test...'));
  
  const stressTest = new NeorestStressTest(config);
  
  try {
    await stressTest.setup();
    const metrics = await stressTest.run();
    stressTest.printResults(metrics);
  } catch (error) {
    console.error(chalk.red('❌ Stress test failed:', error));
    throw error;
  } finally {
    await stressTest.cleanup();
  }
}

async function runMemoryTest(config: MemoryTestConfig): Promise<void> {
  console.log(chalk.yellow('\n🧠 Running Memory Leak Test...'));
  
  const memoryTest = new NeorestMemoryTest(config);
  
  try {
    await memoryTest.setup();
    await memoryTest.run();
  } catch (error) {
    console.error(chalk.red('❌ Memory test failed:', error));
    throw error;
  } finally {
    await memoryTest.cleanup();
  }
}

async function runFullBenchmark(): Promise<void> {
  console.log(chalk.yellow('\n📊 Running Full Benchmark Suite...'));
  
  const startTime = Date.now();
  
  try {
    // Run stress test
    const stressConfig: StressTestConfig = {
      connections: 50,
      messagesPerConnection: 20,
      messageSize: 1024,
      duration: 30000,
      concurrentConnections: true
    };
    
    await runStressTest(stressConfig);
    
    // Wait between tests
    console.log(chalk.blue('\n⏳ Waiting 5 seconds between tests...'));
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Run memory test
    const memoryConfig: MemoryTestConfig = {
      iterations: 30,
      connectionsPerIteration: 10,
      delayBetweenIterations: 200,
      gcBetweenIterations: true
    };
    
    await runMemoryTest(memoryConfig);
    
    const totalDuration = Date.now() - startTime;
    console.log(chalk.green(`\n✅ Full benchmark completed in ${(totalDuration / 1000).toFixed(2)}s`));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Full benchmark failed:', error));
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(chalk.white(`
Usage: npm run bench [options]

Commands:
  stress                    Run stress test only
  memory                    Run memory leak test only
  full                      Run full benchmark suite (default)

Stress Test Options:
  --connections=N          Number of concurrent connections (default: 50)
  --messages=N             Messages per connection (default: 20)
  --size=N                 Message size in bytes (default: 1024)

Memory Test Options:
  --iterations=N           Number of iterations (default: 30)
  --connections=N          Connections per iteration (default: 10)
  --delay=N                Delay between iterations in ms (default: 200)
  --no-gc                  Disable garbage collection between iterations

Examples:
  npm run bench stress --connections=100 --messages=50
  npm run bench memory --iterations=50 --connections=20
  npm run bench full
`));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }
  
  const command = args[0] || 'full';
  
  switch (command) {
    case 'stress':
      const stressConfig: StressTestConfig = {
        connections: 50,
        messagesPerConnection: 20,
        messageSize: 1024,
        duration: 30000,
        concurrentConnections: true
      };
      
      // Parse stress test arguments
      for (const arg of args.slice(1)) {
        if (arg.startsWith('--connections=')) {
          stressConfig.connections = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--messages=')) {
          stressConfig.messagesPerConnection = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--size=')) {
          stressConfig.messageSize = parseInt(arg.split('=')[1]);
        }
      }
      
      await runStressTest(stressConfig);
      break;
      
    case 'memory':
      const memoryConfig: MemoryTestConfig = {
        iterations: 30,
        connectionsPerIteration: 10,
        delayBetweenIterations: 200,
        gcBetweenIterations: true
      };
      
      // Parse memory test arguments
      for (const arg of args.slice(1)) {
        if (arg.startsWith('--iterations=')) {
          memoryConfig.iterations = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--connections=')) {
          memoryConfig.connectionsPerIteration = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--delay=')) {
          memoryConfig.delayBetweenIterations = parseInt(arg.split('=')[1]);
        } else if (arg === '--no-gc') {
          memoryConfig.gcBetweenIterations = false;
        }
      }
      
      await runMemoryTest(memoryConfig);
      break;
      
    case 'full':
      await runFullBenchmark();
      break;
      
    default:
      console.error(chalk.red(`❌ Unknown command: ${command}`));
      showHelp();
      process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red('❌ Benchmark failed:', error));
    process.exit(1);
  });
}