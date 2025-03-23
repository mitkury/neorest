# Neorest Tests

This directory contains tests for the Neorest project. The project has been restructured to focus on proper tests rather than examples.

## Test Directories

- `deno-core/`: Integration tests for the core package using Deno

## Running Tests

### Core Integration Tests

Integration tests for the core package can be run with:

```bash
# Using npm scripts
npm run test:core:integration

# Or directly with Deno
cd tests/deno-core
./run_test.sh
```

These tests verify the basic functionality of the core package, including message passing and handling of route messages.

## Adding New Tests

To add new tests:

1. Create a new directory for your test category (e.g., `tests/node-core/` for Node.js tests)
2. Add an import map for proper module resolution
3. Add the test file with appropriate test framework
4. Add a run script to the main package.json

## Test Structure

Each test directory should be self-contained with its own:
- Import map for dependency resolution
- Test files
- Run scripts