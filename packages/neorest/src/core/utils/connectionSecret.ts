import { ConnectionSecret } from '../types';

/**
 * Generate a random string of specified length
 * @param length - The length of the string
 * @returns The random string
 */
function generateSecret(length: number): string {
  const array = new Uint8Array(length);

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random number generation is unavailable');
  }

  globalThis.crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a new connection secret
 * @returns The connection secret
 */
export function newConnectionSecret(): ConnectionSecret {
  return generateSecret(32);
}
