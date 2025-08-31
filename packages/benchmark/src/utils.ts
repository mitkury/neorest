import { performance } from 'perf_hooks';
import { BenchmarkResult, TestMetrics } from './types';

export class PerformanceTimer {
  private startTime: number = 0;
  private endTime: number = 0;

  start(): void {
    this.startTime = performance.now();
  }

  stop(): number {
    this.endTime = performance.now();
    return this.endTime - this.startTime;
  }

  getDuration(): number {
    return this.endTime - this.startTime;
  }
}

export function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024), // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
    external: Math.round(usage.external / 1024 / 1024), // MB
  };
}

export function generateRandomData(size: number): any {
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

export function calculateMetrics(
  results: BenchmarkResult[],
  totalConnections: number,
  successfulConnections: number,
  totalMessages: number,
  successfulMessages: number,
  responseTimes: number[]
): TestMetrics {
  const failedConnections = totalConnections - successfulConnections;
  const failedMessages = totalMessages - successfulMessages;
  
  const avgResponseTime = responseTimes.length > 0 
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
    : 0;
  
  const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
  const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;

  // Check for memory leaks by comparing initial and final memory usage
  const initialMemory = results[0]?.memoryUsage.heapUsed || 0;
  const finalMemory = results[results.length - 1]?.memoryUsage.heapUsed || 0;
  const memoryGrowth = finalMemory - initialMemory;
  
  // Consider it a memory leak if memory grew by more than 50MB
  const memoryLeakDetected = memoryGrowth > 50;

  return {
    totalConnections,
    successfulConnections,
    failedConnections,
    totalMessages,
    successfulMessages,
    failedMessages,
    averageResponseTime: avgResponseTime,
    maxResponseTime,
    minResponseTime,
    memoryLeakDetected,
    memoryGrowth,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = values.sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index];
}