import { NodeRouter } from '@neorest/router-node';
import { Client } from 'neorest';

// Example server
async function startServer() {
  const router = new NodeRouter({
    port: 8080,
    hostname: 'localhost'
  });

  // Define routes
  router
    .onGet('/users', async (ctx) => {
      console.log('GET /users');
      // In a real app, fetch users from a database
      ctx.response = [
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' }
      ];
    })
    .onPost('/users', async (ctx) => {
      console.log('POST /users', ctx.data);
      // In a real app, create a user in a database
      const newUser = {
        id: 3,
        ...ctx.data
      };
      ctx.response = newUser;
      
      // Broadcast to all subscribers
      router.broadcastPost('/users', newUser, ctx.sender);
    })
    .onDelete('/users/:id', async (ctx) => {
      const userId = ctx.params.id;
      console.log(`DELETE /users/${userId}`);
      
      // In a real app, delete the user from a database
      ctx.response = { success: true };
      
      // Broadcast deletion to all subscribers
      router.broadcastDeletion(`/users/${userId}`, { id: userId });
    })
    .onValidateBroadcast('/users/:id', (conn, params) => {
      // In a real app, check if the connection has permission to receive updates for this user
      return true;
    });

  await router.listen();
  console.log('Server started on http://localhost:8080');
  
  return router;
}

// Example client
async function startClient() {
  const client = new Client('ws://localhost:8080');
  
  // Wait for connection
  while (!client.isConnected()) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Subscribe to users
  await client.on('/users', (event) => {
    console.log(`Received ${event.action} event for users:`, event.data);
  });
  
  // Get users
  const usersResponse = await client.get('/users');
  console.log('Users:', usersResponse.data);
  
  // Create a user
  const newUserResponse = await client.post('/users', { name: 'Alice' });
  console.log('New user:', newUserResponse.data);
  
  return client;
}

// Main function
async function main() {
  try {
    const server = await startServer();
    
    // In a real app, the client would be in a separate process
    const client = await startClient();
    
    // Clean up after 5 seconds
    setTimeout(async () => {
      client.close();
      await server.close();
      console.log('Example completed');
    }, 5000);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main();