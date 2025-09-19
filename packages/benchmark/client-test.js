#!/usr/bin/env node

console.log('🧪 Testing client connection...\n');

try {
  console.log('Importing modules...');
  const { NodeRouter } = await import('neorest/node');
  const { Client } = await import('neorest');
  console.log('✅ Modules imported successfully');
  
  console.log('Creating and starting server...');
  const server = new NodeRouter({ port: 9000 });
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  await server.listen();
  console.log('✅ Server started successfully');
  
  console.log('Creating client...');
  const client = new Client('ws://localhost:9000', 'websocket');
  console.log('✅ Client created successfully');
  
  console.log('Attempting to connect with 3 second timeout...');
  const connectPromise = client.conn.connect();
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Connection timeout after 3 seconds')), 3000)
  );
  
  try {
    await Promise.race([connectPromise, timeoutPromise]);
    console.log('✅ Client connected successfully');
    
    console.log('Testing ping...');
    const pong = await client.get('/ping');
    console.log(`✅ Ping response: ${pong.data}`);
    
    console.log('Closing client...');
    await client.close();
    console.log('✅ Client closed successfully');
    
  } catch (connectError) {
    console.error('❌ Connection failed:', connectError.message);
  }
  
  console.log('Stopping server...');
  await server.close();
  console.log('✅ Server stopped successfully');
  
  console.log('\n🎉 Client test completed!');
  
} catch (error) {
  console.error('❌ Client test failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}