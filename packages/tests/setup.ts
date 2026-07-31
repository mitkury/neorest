import WebSocket from 'ws';

// Node only gained a built-in WebSocket client in newer releases. Exercise the
// same browser-compatible transport implementation across the supported Node
// matrix instead of silently depending on the test runner's Node version.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}
