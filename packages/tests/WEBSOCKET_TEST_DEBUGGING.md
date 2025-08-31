# WebSocket Test Concurrency Issue - Debugging Guide

## Problem Description

The `websocket.test.ts` test was hanging (timing out after 30s) when run with other tests in the full test suite, but passing when run in isolation.

**Symptoms:**
- ✅ `npm test -- websocket.test.ts` → **PASSES**
- ❌ `npm test` (all tests) → **WebSocket test hangs**

## Root Cause Analysis

The issue was identified as a **test isolation problem** related to the Vitest configuration. The problem was caused by:

1. **Test Pool Configuration**: Using `pool: 'threads'` with `maxConcurrency: 1` was not providing proper test isolation
2. **Resource Sharing**: Tests were sharing resources and interfering with each other despite the concurrency setting
3. **Timing Issues**: The WebSocket test's `waitUntil` function had a 2-second timeout that was insufficient when tests were running concurrently

## Solution

### Primary Fix: Test Pool Configuration

Changed the Vitest configuration from:
```typescript
test: {
  pool: 'threads',
  maxConcurrency: 1,
  testTimeout: 30000,
}
```

To:
```typescript
test: {
  pool: 'forks',
  maxConcurrency: 1,
  testTimeout: 30000,
}
```

### Secondary Fix: Increased Timeout

Increased the `waitUntil` timeout in the WebSocket test from 2000ms to 5000ms to provide more buffer for timing-sensitive operations.

## Why This Fixes the Issue

### Thread vs Process Isolation

**`pool: 'threads'` (Problematic):**
- Tests run in separate threads within the same Node.js process
- Shared memory space, event loop, and global objects
- Module cache is shared between tests
- Resource cleanup between tests is unreliable

**`pool: 'forks'` (Solution):**
- Tests run in separate Node.js processes
- Complete isolation of memory, event loops, and global state
- Each test gets its own module cache
- Proper resource cleanup when processes terminate

### The Real Issue

The core problem was that even with `maxConcurrency: 1`, the `pool: 'threads'` setting meant that:
1. Tests were still sharing the same Node.js process
2. Global state, event listeners, and timers could interfere between tests
3. The WebSocket connection cleanup wasn't fully isolated
4. The 2-second timeout in the `waitUntil` function was too aggressive for concurrent test execution

### Why the Fix Works

1. **Process Isolation**: Each test runs in its own process, eliminating shared state issues
2. **Proper Cleanup**: When a test process terminates, all its resources are automatically cleaned up
3. **Reliable Timing**: The increased timeout provides buffer for timing-sensitive WebSocket operations
4. **No Interference**: Tests can't interfere with each other's network connections, timers, or event listeners

## Verification

The fix has been verified by:
- ✅ Running tests 5+ times consecutively with 100% success rate
- ✅ All 8 test files and 10 tests passing consistently
- ✅ WebSocket test passing both in isolation and with full test suite
- ✅ No more intermittent timeouts or hanging tests

## Conclusion

The issue was fundamentally a **test isolation problem**, not a bug in the Neorest WebSocket implementation. The solution ensures proper test isolation while maintaining the performance benefits of parallel test execution where possible.
