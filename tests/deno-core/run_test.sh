#!/usr/bin/env bash

# Run the core integration tests
echo "Running core integration tests..."
deno test --allow-net --import-map=import_map.json client_server_test.ts

echo "All tests completed!"