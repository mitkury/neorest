export interface BenchmarkResult {
  name: string;
  duration: number;
  operations: number;
  opsPerSecond: number;
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  errors: number;
  timestamp: string;
}

export interface StressTestConfig {
  connections: number;
  messagesPerConnection: number;
  messageSize: number;
  duration: number;
  concurrentConnections: boolean;
}

export interface MemoryTestConfig {
  iterations: number;
  connectionsPerIteration: number;
  delayBetweenIterations: number;
  gcBetweenIterations: boolean;
}

export interface ConcurrentTestConfig {
  maxConcurrentConnections: number;
  totalConnections: number;
  messagesPerConnection: number;
  rampUpTime: number;
}

export interface TestMetrics {
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  totalMessages: number;
  successfulMessages: number;
  failedMessages: number;
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  memoryLeakDetected: boolean;
  memoryGrowth: number;
}