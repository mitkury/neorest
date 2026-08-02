import { createServer } from 'node:net';

/** Ask the OS for a currently available TCP port. */
async function getNextPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (!port) throw new Error('The operating system did not allocate a test port');
  return port;
}

export const portManager = { getNextPort };
