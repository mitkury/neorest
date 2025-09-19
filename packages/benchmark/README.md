# Neorest Benchmark Suite

This benchmark suite tests the performance of Neorest WebSocket connections, message throughput, and reconnection capabilities.

## Usage

```bash
# Run all benchmarks
npm run benchmark

# Run specific benchmarks
npm run connection      # Connection time benchmarks
npm run throughput      # Message throughput benchmarks  
npm run reconnection    # Reconnection performance benchmarks
npm run stress          # Stress test with multiple connections
```

## Benchmarks

### 1. Connection Time
Tests how quickly WebSocket connections can be established.
- Measures connection establishment time
- Runs 5 iterations to get average performance

### 2. Message Throughput
Tests how many messages can be sent and received per second.
- Tests different message counts (10, 50, 100)
- Measures end-to-end message processing time

### 3. Reconnection Performance
Tests the reconnection mechanism with secret preservation.
- Simulates connection drops
- Tests reconnection with same secret
- Verifies functionality after reconnection

### 4. Stress Test
Tests system performance under load with multiple concurrent connections.
- Tests with 5, 10, and 20 concurrent connections
- Measures system stability under load

## Expected Results

After the WebSocket timeout fixes, you should see:
- **Consistent connection times** (no more intermittent failures)
- **Fast reconnection** (secrets preserved correctly)
- **Stable performance** under load
- **No race conditions** or timeouts

## Performance Targets

- **Connection time**: < 100ms per connection
- **Message throughput**: > 100 messages/second
- **Reconnection time**: < 200ms
- **Stress test**: Handle 20+ concurrent connections without issues