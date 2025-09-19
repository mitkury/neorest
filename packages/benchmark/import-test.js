#!/usr/bin/env node

console.log('🧪 Testing imports...\n');

try {
  console.log('Importing NodeRouter...');
  const { NodeRouter } = await import('neorest/node');
  console.log('✅ NodeRouter imported successfully');
  
  console.log('Importing Client...');
  const { Client } = await import('neorest');
  console.log('✅ Client imported successfully');
  
  console.log('Creating server...');
  const server = new NodeRouter({ port: 9000 });
  console.log('✅ Server created successfully');
  
  console.log('Creating client...');
  const client = new Client('ws://localhost:9000', 'websocket');
  console.log('✅ Client created successfully');
  
  console.log('\n🎉 All imports and basic object creation work!');
  
} catch (error) {
  console.error('❌ Import test failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}