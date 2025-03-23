# Neorest Deno Test

This folder contains a simple test of Neorest using Deno for both the server and client.

## Components

- `server.ts`: A Deno server that uses the Neorest router
- `client.ts`: A Deno client that connects to the server and interacts with it
- `run_test.ts`: A script that runs both server and client together

## Running the Test

### Method 1: Using the Test Runner

The easiest way to run the test is to use the provided test runner script:

```bash
deno run -A run_test.ts
```

This will:
1. Start the server in a background process
2. Wait for the server to initialize
3. Run the client
4. Display output from both processes
5. Shut down the server when the client finishes

### Method 2: Running Server and Client Separately

You can also run the server and client in separate terminals:

Terminal 1:
```bash
deno run -A server.ts
```

Terminal 2:
```bash
deno run -A client.ts
```

## What the Test Does

1. The server sets up several routes:
   - GET /users - Returns a list of users
   - POST /users - Creates a new user
   - DELETE /users/:id - Deletes a user

2. The client:
   - Connects to the server
   - Subscribes to updates on the /users route
   - Gets the list of users
   - Creates a new user
   - Deletes the user it just created
   - Receives broadcast notifications for both operations

This test demonstrates the core functionality of Neorest:
- REST-style operations (GET, POST, DELETE)
- Real-time subscriptions to routes
- Broadcasting updates to subscribers

## Expected Output

If everything works correctly, you should see:
- The client connecting to the server
- The client receiving the initial user list
- The client creating a new user
- The client receiving a broadcast notification about the new user
- The client deleting the user
- The client receiving a broadcast notification about the deletion