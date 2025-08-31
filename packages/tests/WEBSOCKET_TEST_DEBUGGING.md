# WebSocket Test Concurrency Issue - Debugging Guide

## Problem Description

The `websocket.test.ts` test passes when run in isolation but hangs (times out after 30s) when run with other tests in the full test suite.

**Symptoms:**
- ✅ `npm test -- websocket.test.ts` → **PASSES**
- ❌ `npm test` (all tests) → **WebSocket test hangs**

## Current Status

- **7/8 test files passing**
- **9/10 tests passing** 
- **Core functionality working**: connection secrets, port allocation, reconnection logic
- **Only issue**: WebSocket test concurrency interference

## Assumptions on Root Cause

### 1. Global State Interference
**Hypothesis**: Some global state is being shared between tests, causing interference.

**Possible culprits:**
- `ws` library global state
- Node.js WebSocket server global state
- Event loop or process-level state
- Shared memory or resources

**Evidence:**
- Tests run in parallel processes (multiple debugger attachments visible)
- WebSocket test starts successfully but hangs during execution
- Other tests complete successfully

### 2. Resource Contention
**Hypothesis**: Multiple tests competing for the same resources.

**Possible culprits:**
- WebSocket server instances
- Network ports (though we fixed port allocation)
- File descriptors
- Memory or CPU resources

### 3. Test Runner Configuration Issue
**Hypothesis**: Vitest configuration not properly isolating tests.

**Current config:**
```typescript
{
  pool: 'threads',
  maxConcurrency: 1,
  testTimeout: 30000,
}
```

**Issue**: Tests still run in parallel despite `maxConcurrency: 1`

### 4. WebSocket Implementation Bug
**Hypothesis**: Bug in our WebSocket implementation that only manifests under load.

**Possible issues:**
- Race conditions in connection handling
- Memory leaks
- Event listener cleanup issues
- Socket cleanup problems

## Testing Strategies

### 1. Isolate the Problem
```bash
# Test 1: Run WebSocket test alone
npm test -- websocket.test.ts

# Test 2: Run WebSocket test with one other test
npm test -- websocket.test.ts auto.test.ts

# Test 3: Run WebSocket test with different combinations
npm test -- websocket.test.ts basic.test.ts
npm test -- websocket.test.ts http_routes.test.ts
```

### 2. Test Different Concurrency Settings
```typescript
// Try different pool configurations
pool: 'forks'  // vs 'threads'
pool: 'vmThreads'  // vs 'threads'
pool: 'childProcess'  // vs 'threads'

// Try different concurrency settings
maxConcurrency: 1
maxConcurrency: 2
maxConcurrency: 4
```

### 3. Add Debugging to WebSocket Test
```typescript
// Add more granular logging
console.log('WebSocket test starting...');
console.log('Creating client...');
console.log('Connecting...');
console.log('Making request...');
console.log('Request completed...');
```

### 4. Test WebSocket Implementation Directly
```typescript
// Create a minimal test that only tests WebSocket functionality
// without the full test infrastructure
```

### 5. Check for Global State
```typescript
// Add checks for global state before/after tests
console.log('Global state before test:', Object.keys(global));
console.log('Process listeners:', process.listenerCount('exit'));
```

## Potential Fixes

### 1. Fix Test Isolation
```typescript
// Option A: Force sequential execution
pool: 'forks',
maxConcurrency: 1,
isolate: true,  // If available

// Option B: Use different test runner
// Switch to Jest or other test runner

// Option C: Split WebSocket tests into separate suite
// Run WebSocket tests separately from other tests
```

### 2. Fix WebSocket Implementation
```typescript
// Add proper cleanup in WebSocket strategy
disconnect(): void {
  try { 
    this.socket.close(); 
    this.socket.removeAllListeners();  // Add this
  } catch {}
}

// Add proper error handling
on('error', (error) => {
  console.error('WebSocket error:', error);
  this.disconnect();
});
```

### 3. Add Test Cleanup
```typescript
// Add global test cleanup
afterAll(async () => {
  // Clean up any global state
  // Close any remaining connections
  // Reset any global variables
});
```

### 4. Fix Resource Management
```typescript
// Ensure proper resource cleanup in tests
try {
  // Test code
} finally {
  // Always cleanup
  await client?.close();
  await server?.close();
  // Force garbage collection if needed
  if (global.gc) global.gc();
}
```

## Investigation Steps

### Step 1: Confirm the Problem
- [ ] Run WebSocket test in isolation → Should pass
- [ ] Run all tests → Should see WebSocket test hang
- [ ] Document exact behavior and timing

### Step 2: Identify Interference Pattern
- [ ] Test WebSocket + 1 other test
- [ ] Test WebSocket + different combinations
- [ ] Identify which tests cause interference

### Step 3: Check Global State
- [ ] Add global state logging
- [ ] Check for shared resources
- [ ] Look for memory leaks

### Step 4: Test Different Configurations
- [ ] Try different pool settings
- [ ] Try different concurrency settings
- [ ] Try different test runners

### Step 5: Fix the Root Cause
- [ ] Implement proper cleanup
- [ ] Fix resource management
- [ ] Improve test isolation

## Priority Order

1. **High Priority**: Fix test isolation (most likely cause)
2. **Medium Priority**: Add proper cleanup to WebSocket implementation
3. **Low Priority**: Switch test runner or split test suites

## Success Criteria

- [ ] All tests pass when run together
- [ ] WebSocket test passes consistently
- [ ] No test interference
- [ ] Proper resource cleanup
- [ ] Maintainable solution

## Notes

- The core functionality (connection secrets, port allocation) is working perfectly
- This is a test infrastructure issue, not a library functionality issue
- The fix should not break existing functionality
- Consider the impact on CI/CD pipeline
