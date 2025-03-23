/**
 * Run test script for simplified Deno demo
 * Run with: deno run -A run_test.ts
 */

// Main function that orchestrates the test
async function runTest() {
  console.log("Starting Neorest simplified test...");
  
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
  
  // Run the client
  console.log("Starting client...");
  const clientProcess = new Deno.Command("deno", {
    args: ["run", "-A", "./packages/examples/src/deno-simple/client.ts"],
    stdout: "piped",
    stderr: "piped",
    cwd: "/Users/dk/repos/neorest",
  }).spawn();
  
  // Read client output
  for await (const chunk of clientProcess.stdout) {
    console.log("[Client]", decoder.decode(chunk).trim());
  }
  
  // Read client errors
  for await (const chunk of clientProcess.stderr) {
    console.error("[Client Error]", decoder.decode(chunk).trim());
  }
  
  // Wait for client to complete
  const clientStatus = await clientProcess.status;
  console.log("Client process exited with status:", clientStatus.code);
  
  // Kill server after client completes
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
  
  console.log("Neorest test completed!");
}

// Run the test
runTest();