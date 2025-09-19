#!/usr/bin/env node

console.log('🧪 Testing server startup...\n');

try {
  console.log('Importing NodeRouter...');
  const { NodeRouter } = await import('neorest/node');
  console.log('✅ NodeRouter imported successfully');
  
  console.log('Creating server...');
  const server = new NodeRouter({ port: 9000 });
  console.log('✅ Server created successfully');
  
  console.log('Adding routes...');
  server
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });
  console.log('✅ Routes added successfully');
  
  console.log('Starting server...');
  await server.listen();
  console.log('✅ Server started successfully');
  
  console.log('Waiting 2 seconds...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('Stopping server...');
  await server.close();
  console.log('✅ Server stopped successfully');
  
  console.log('\n🎉 Server test completed successfully!');
  
} catch (error) {
  console.error('❌ Server test failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}