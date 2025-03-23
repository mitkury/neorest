/**
 * Dual client test script for Neorest
 * This script runs both WebSocket and HTTP clients against the same server
 * Run with: deno run -A dual-client-test.ts
 */

// Main function that orchestrates the test
async function runTest() {
  console.log("Starting Neorest dual client test...");
  
  // Start the server in a subprocess
  console.log("Starting server...");
  const serverProcess = new Deno.Command("deno", {
    args: ["run", "-A", "./packages/examples/src/deno-simple/server.ts"],
    stdout: "piped",
    stderr: "piped",
    cwd: "/Users/dk/repos/neorest",
  }).spawn();
  
  // Create a decoder for reading server output
  const decoder = new TextDecoder();
  
  // Function to read server output
  const readServerOutput = async () => {
    for await (const chunk of serverProcess.stdout) {
      console.log("[Server]", decoder.decode(chunk).trim());
    }
  };
  
  // Function to read server errors
  const readServerErrors = async () => {
    for await (const chunk of serverProcess.stderr) {
      console.error("[Server Error]", decoder.decode(chunk).trim());
    }
  };
  
  // Start reading server output
  readServerOutput();
  readServerErrors();
  
  // Wait for server to start
  console.log("Waiting for server to start...");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Run the WebSocket client
  console.log("Starting WebSocket client...");
  const wsClientProcess = new Deno.Command("deno", {
    args: ["run", "-A", "./packages/examples/src/deno-simple/client.ts"],
    stdout: "piped",
    stderr: "piped",
    cwd: "/Users/dk/repos/neorest",
  }).spawn();
  
  // Run the HTTP client in parallel
  console.log("Starting HTTP client...");
  const httpClientProcess = new Deno.Command("deno", {
    args: ["run", "-A", "./packages/examples/src/deno-simple/http-client.ts"],
    stdout: "piped",
    stderr: "piped",
    cwd: "/Users/dk/repos/neorest",
  }).spawn();
  
  // Function to read WebSocket client output
  const readWsClientOutput = async () => {
    for await (const chunk of wsClientProcess.stdout) {
      console.log("[WS Client]", decoder.decode(chunk).trim());
    }
  };
  
  // Function to read WebSocket client errors
  const readWsClientErrors = async () => {
    for await (const chunk of wsClientProcess.stderr) {
      console.error("[WS Client Error]", decoder.decode(chunk).trim());
    }
  };
  
  // Function to read HTTP client output
  const readHttpClientOutput = async () => {
    for await (const chunk of httpClientProcess.stdout) {
      console.log("[HTTP Client]", decoder.decode(chunk).trim());
    }
  };
  
  // Function to read HTTP client errors
  const readHttpClientErrors = async () => {
    for await (const chunk of httpClientProcess.stderr) {
      console.error("[HTTP Client Error]", decoder.decode(chunk).trim());
    }
  };
  
  // Start reading client output
  readWsClientOutput();
  readWsClientErrors();
  readHttpClientOutput();
  readHttpClientErrors();
  
  // Wait for both clients to complete
  const [wsStatus, httpStatus] = await Promise.all([
    wsClientProcess.status,
    httpClientProcess.status
  ]);
  
  console.log("WebSocket client process exited with status:", wsStatus.code);
  console.log("HTTP client process exited with status:", httpStatus.code);
  
  // Kill server after clients complete
  console.log("Stopping server...");
  if (serverProcess.pid) {
    try {
      serverProcess.kill("SIGTERM");
    } catch (e) {
      console.error("Error killing server process:", e);
    }
  }
  
  // Wait for server to exit
  try {
    const serverStatus = await serverProcess.status;
    console.log("Server process exited with status:", serverStatus.code);
  } catch (e) {
    console.error("Error waiting for server to exit:", e);
  }
  
  console.log("Neorest dual client test completed!");
}

// Run the test
runTest();