# Neorest Benchmark Suite

This comprehensive benchmark suite tests Neorest's performance across multiple load levels, from basic functionality to high-performance scenarios.

## Live audio loopback

The live-audio benchmark exercises a real server-terminated WebRTC session
using the same `@roamhq/wrtc` runtime commonly used by Node applications. It
generates a deterministic PCM WAV, plays it as paced tracks independently in
both directions, and records what the client and server received. Keeping the
two directions separate avoids hiding which media path introduced a
degradation.
The root command uses Node 22 for the media process because that is the newest
runtime currently covered by the native WebRTC provider; this also makes the
result independent of whichever newer Node version happens to be installed.

From the repository root:

```bash
# Portable baseline: macOS, Linux, or Windows
npm run test:live-audio

# Repeat runs to get p50/p95 setup and latency measurements
npm run test:live-audio -- --runs 5

# Add application-level delay, jitter, and dropped audio frames without Docker
npm run test:live-audio -- --profile degraded

# Use a PCM 16-bit WAV; it is downmixed and resampled to 48 kHz as needed
npm run test:live-audio -- --input /absolute/path/speech.wav
```

Each run writes `reference.wav`, `received-client-N.wav`,
`received-server-N.wav`, raw WebRTC stats, per-run
metrics, and `summary.json` under `packages/benchmark/artifacts/live-audio/`.
The metrics include control and live setup time, data-channel RTT, approximate
one-way audio latency in both directions, aligned signal correlation, RMS
ratio, and dropout ratio. Because both peers live in the same benchmark
process, their monotonic timestamps share a clock. Audio is encoded by WebRTC,
so the returned WAV is intentionally not expected to be byte-identical to the
source.

### Packet-level network profiles

Docker is optional. When it is available, the network runner applies Linux
`tc netem` to the container loopback interface, affecting both Neorest
WebSocket signaling and WebRTC packets:

```bash
# Defaults to the wifi profile
npm run test:live-audio:network

NETWORK_PROFILE=clean npm run test:live-audio:network
NETWORK_PROFILE=mobile npm run test:live-audio:network -- --runs 3
NETWORK_PROFILE=poor npm run test:live-audio:network
```

Profiles are deliberately small and understandable:

| Profile | Delay | Jitter | Random loss | Rate |
| --- | ---: | ---: | ---: | ---: |
| `clean` | 0 ms | 0 ms | 0% | unlimited |
| `wifi` | 15 ms | 5 ms | 0.2% | unlimited |
| `mobile` | 40 ms | 15 ms | 1% | unlimited |
| `poor` | 100 ms | 40 ms | 5%, 25% correlation | 512 kbit/s |

The qdisc is applied to `lo` because the benchmark client and server run in
the same isolated Linux network namespace. Docker Desktop provides that Linux
VM on macOS and Windows. The container needs only the scoped `NET_ADMIN`
capability; it does not modify the host network.

Application-level impairment is useful for repeatable media-pipeline tests.
The Docker profiles are the meaningful test for WebRTC congestion, packet
loss, jitter buffering, and signaling behavior.

## Quick Start

```bash
# Install dependencies
npm install

# Run low load benchmarks (recommended for development)
node benchmark.js all

# Run medium load benchmarks
node medium-benchmark.js all

# Run high load benchmarks (production testing)
node high-benchmark.js all
```

## Benchmark Levels

### Low Load Benchmarks (`benchmark.js`)
**Recommended for**: Development and basic testing
- **Connections**: 2-3 concurrent connections
- **Messages**: 5-10 messages per test
- **Reconnections**: 3 reconnection tests
- **Duration**: ~60 seconds total

### Medium Load Benchmarks (`medium-benchmark.js`)
**Recommended for**: Integration testing and optimization
- **Connections**: 5-15 concurrent connections
- **Messages**: 25-100 messages per test
- **Reconnections**: 5 reconnection tests
- **Duration**: ~2-3 minutes total

### High Load Benchmarks (`high-benchmark.js`)
**Recommended for**: Production validation and performance testing
- **Connections**: 10-100 concurrent connections
- **Messages**: 200-1000 messages per test
- **Reconnections**: 10 reconnection tests
- **Mixed Load**: 20 connections × 100 messages each
- **Duration**: ~5-10 minutes total

## Individual Test Types

```bash
# Connection performance
node benchmark.js connection

# Message throughput
node benchmark.js throughput

# Reconnection reliability
node benchmark.js reconnection

# Stress testing
node benchmark.js stress

# Mixed load (high benchmark only)
node high-benchmark.js mixed
```

## Expected Performance Results

### Connection Performance
- **Low Load**: 1.7-12.1ms per connection
- **High Load**: 1.1-11.9ms per connection
- **Consistency**: Excellent across multiple runs

### Message Throughput
- **Small batches (5-10 messages)**: 1,500-6,000 msg/s
- **Medium batches (25-100 messages)**: 4,000-91,000 msg/s
- **Large batches (200-1000 messages)**: 22,500-1,670,000 msg/s

### Reconnection Performance
- **Reconnection Time**: ~103ms consistently
- **Success Rate**: 100% across all test scenarios
- **Secret Preservation**: Perfect reliability

### Concurrent Connections
- **Low Load**: 2-3 connections in ~3-8ms
- **Medium Load**: 5-15 connections in ~7-19ms
- **High Load**: 25-100 connections in ~28-107ms

## Performance Validation

All benchmarks have been validated with:
- ✅ **Multiple test runs** for consistency verification
- ✅ **100% message delivery** success rate
- ✅ **Zero connection failures** across all scenarios
- ✅ **Perfect reconnection** reliability
- ✅ **Linear scaling** characteristics

## Troubleshooting

If benchmarks fail or hang:
1. Ensure all dependencies are installed: `npm install`
2. Check that no other services are using ports 9000-9020
3. Build the runtime package first: `cd ../.. && npm run build`
4. Run individual tests to isolate issues

## Performance Targets (Achieved)

- ✅ **Connection time**: < 15ms per connection (achieved: 1-12ms)
- ✅ **Message throughput**: > 1,000 messages/second (achieved: 1M+ msg/s)
- ✅ **Reconnection time**: < 200ms (achieved: ~103ms)
- ✅ **Concurrent connections**: > 20 connections (achieved: 100+ connections)
- ✅ **Message reliability**: 100% delivery rate (achieved: 100%)
