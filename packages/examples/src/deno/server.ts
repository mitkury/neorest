// Import using import map
import { DenoRouter } from '@neorest/router-deno/DenoRouter.ts';

// Create a server
const router = new DenoRouter({
  port: 8080,
  hostname: 'localhost'
});

// Define some routes
router
  .onGet('/users', (ctx) => {
    console.log('GET /users requested');
    // Example data
    ctx.response = [
      { id: 1, name: 'John Doe' },
      { id: 2, name: 'Jane Smith' }
    ];
  })
  .onPost('/users', (ctx) => {
    console.log('POST /users:', ctx.data);
    
    // Create a new user (in a real app, this would go to a database)
    const newUser = {
      id: Date.now(),
      ...ctx.data
    };
    
    // Set the response
    ctx.response = newUser;
    
    // Broadcast to all subscribers
    router.broadcastPost('/users', newUser, ctx.sender);
    console.log('Broadcasted new user to subscribers');
  })
  .onDelete('/users/:id', (ctx) => {
    const userId = ctx.params.id;
    console.log(`DELETE /users/${userId} requested`);
    
    // Set the response
    ctx.response = { success: true, id: userId };
    
    // Broadcast deletion
    router.broadcastDeletion(`/users/${userId}`, { id: userId });
    console.log(`Broadcasted deletion of user ${userId}`);
  })
  .onValidateBroadcast('/users/:id', (conn, params) => {
    // In a real app, this would check if the connection has permission
    // to receive updates for this user
    return true;
  });

// Start the server
console.log('Starting Neorest server...');
await router.listen();
console.log('Neorest server running at http://localhost:8080');

// Keep the process running
await new Promise(() => {});