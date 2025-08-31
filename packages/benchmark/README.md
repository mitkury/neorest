# Neorest Performance Benchmarking Suite

A comprehensive benchmarking and stress testing suite for the Neorest framework, designed to detect performance issues, memory leaks, and scalability problems.

## 🚀 Features

- **Stress Testing**: Test connection limits and message throughput
- **Memory Leak Detection**: Identify memory leaks in connection lifecycle
- **Performance Metrics**: Detailed performance analysis and reporting
- **Automated Testing**: Easy-to-use CLI interface
- **Real-time Monitoring**: Progress bars and live metrics
- **Configurable**: Customizable test parameters

## 📦 Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## 🧪 Available Tests

### 1. Stress Test
Tests the system under high load with multiple concurrent connections and messages.

**What it tests:**
- Connection establishment under load
- Message throughput
- Response times
- Error rates
- Memory usage under stress

### 2. Memory Leak Test
Specifically designed to detect memory leaks in the connection lifecycle.

**What it tests:**
- Memory growth patterns
- Connection cleanup effectiveness
- Garbage collection behavior
- Memory leak detection

### 3. Full Benchmark Suite
Runs both stress and memory tests in sequence for comprehensive analysis.

## 🎯 Usage

### Basic Usage

```bash
# Run full benchmark suite
npm run bench

# Run stress test only
npm run bench stress

# Run memory leak test only
npm run bench memory
```

### Advanced Configuration

#### Stress Test Options

```bash
# Custom stress test configuration
npm run bench stress --connections=200 --messages=100 --size=2048
```

**Parameters:**
- `--connections=N`: Number of concurrent connections (default: 50)
- `--messages=N`: Messages per connection (default: 20)
- `--size=N`: Message size in bytes (default: 1024)

#### Memory Test Options

```bash
# Custom memory test configuration
npm run bench memory --iterations=100 --connections=20 --delay=500
```

**Parameters:**
- `--iterations=N`: Number of iterations (default: 30)
- `--connections=N`: Connections per iteration (default: 10)
- `--delay=N`: Delay between iterations in ms (default: 200)
- `--no-gc`: Disable garbage collection between iterations

### Examples

```bash
# Light stress test
npm run bench stress --connections=25 --messages=10

# Heavy stress test
npm run bench stress --connections=500 --messages=50 --size=4096

# Quick memory test
npm run bench memory --iterations=20 --connections=5

# Thorough memory test
npm run bench memory --iterations=100 --connections=50 --delay=1000

# Full benchmark with custom settings
npm run bench full
```

## 📊 Understanding Results

### Stress Test Metrics

- **Connection Success Rate**: Percentage of successful connections
- **Message Success Rate**: Percentage of successful messages
- **Response Times**: Min, max, and average response times
- **Memory Usage**: Heap usage, RSS, and memory growth
- **Memory Leak Detection**: Automatic detection of memory leaks

### Memory Test Analysis

- **Memory Growth Pattern**: Tracks memory usage over iterations
- **Growth Rate**: Memory growth per iteration
- **Trend Analysis**: Identifies upward/downward/stable trends
- **Worst Iterations**: Highlights problematic iterations
- **Leak Detection**: Automatic memory leak detection

### Interpreting Results

#### ✅ Good Results
- Connection success rate > 95%
- Message success rate > 95%
- Memory growth < 10MB total
- Stable or downward memory trend
- No memory leak detected

#### ⚠️ Warning Signs
- Connection success rate < 90%
- Message success rate < 90%
- Memory growth > 50MB total
- Upward memory trend
- Memory leak detected

#### ❌ Critical Issues
- Connection success rate < 80%
- Message success rate < 80%
- Memory growth > 100MB total
- Steep upward memory trend
- Consistent memory leak detection

## 🔧 Configuration

### Default Settings

```typescript
// Stress Test Defaults
{
  connections: 50,
  messagesPerConnection: 20,
  messageSize: 1024,
  duration: 30000,
  concurrentConnections: true
}

// Memory Test Defaults
{
  iterations: 30,
  connectionsPerIteration: 10,
  delayBetweenIterations: 200,
  gcBetweenIterations: true
}
```

### Custom Configuration

You can modify the default configurations in the respective test files:

- `src/stress-test.ts` - Stress test configuration
- `src/memory-test.ts` - Memory test configuration
- `src/index.ts` - Full benchmark configuration

## 🚨 Troubleshooting

### Common Issues

1. **Port Already in Use**
   - The benchmark automatically finds available ports
   - If issues persist, check for other services using ports 8000-9000

2. **Memory Test Fails**
   - Ensure Node.js is running with garbage collection enabled
   - Use `--expose-gc` flag: `node --expose-gc dist/memory-test.js`

3. **Stress Test Timeout**
   - Reduce the number of connections or messages
   - Increase system resources
   - Check for network issues

4. **High Memory Usage**
   - This is expected during stress tests
   - Monitor the memory growth pattern, not absolute values
   - Look for memory leaks in the analysis

### Performance Tips

1. **For Accurate Results**
   - Run tests on dedicated hardware
   - Close other applications
   - Use consistent system conditions

2. **For Memory Testing**
   - Enable garbage collection: `node --expose-gc`
   - Run multiple iterations
   - Monitor system memory usage

3. **For Stress Testing**
   - Start with small numbers and increase gradually
   - Monitor system resources
   - Check for network bottlenecks

## 📈 Continuous Integration

### GitHub Actions Example

```yaml
name: Performance Benchmark
on: [push, pull_request]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run bench memory --iterations=20
      - run: npm run bench stress --connections=25 --messages=10
```

### Automated Monitoring

The benchmark suite can be integrated into CI/CD pipelines to:

- Detect performance regressions
- Monitor memory usage trends
- Ensure code quality standards
- Provide performance baselines

## 🤝 Contributing

### Adding New Tests

1. Create a new test file in `src/`
2. Implement the test class with setup/run/cleanup methods
3. Add configuration types to `src/types.ts`
4. Update the main CLI in `src/index.ts`
5. Add documentation

### Improving Existing Tests

- Add more detailed metrics
- Improve error handling
- Enhance reporting
- Optimize performance

## 📝 License

This benchmarking suite is part of the Neorest project and follows the same license terms.