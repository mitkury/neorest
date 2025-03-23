// Import the client
import { Client } from '@neorest/neorest/Client.ts';

// Create a client
const client = new Client('ws://localhost:8080');

// Function to wait for the client to connect
async function waitForConnection(timeout = 5000) {
  const start = Date.now();
  while (!client.isConnected()) {
    if (Date.now() - start > timeout) {
      throw new Error('Connection timeout');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log('Connected to server');
}

// Main function
async function main() {
  try {
    // Connect to the server
    console.log('Connecting to server...');
    await waitForConnection();

    // Subscribe to user updates
    console.log('Subscribing to /users...');
    await client.on('/users', (event) => {
      console.log(`Received ${event.action} event for /users:`, event.data);
    });
    console.log('Subscribed to /users');

    // Get the list of users
    console.log('Getting users...');
    const usersResponse = await client.get('/users');
    console.log('Users:', usersResponse.data);

    // Create a new user
    console.log('Creating a new user...');
    const newUser = { name: 'Alice Johnson', email: 'alice@example.com' };
    const createResponse = await client.post('/users', newUser);
    console.log('Created user:', createResponse.data);

    // Wait a moment to see broadcast messages
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Delete a user
    console.log('Deleting user...');
    const deleteResponse = await client.delete(`/users/${createResponse.data.id}`);
    console.log('Delete response:', deleteResponse.data);

    // Wait to see the delete broadcast
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Close the connection
    console.log('Closing connection...');
    client.close();
    console.log('Connection closed');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the main function
main();