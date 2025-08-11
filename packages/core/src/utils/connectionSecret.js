/**
 * Generate a random string of specified length
 * @param length - The length of the string
 * @returns The random string
 */
function generateSecret(length) {
    const array = new Uint8Array(length);
    // Use browser crypto if available
    if (typeof window !== 'undefined' && window.crypto) {
        window.crypto.getRandomValues(array);
    }
    // Use node crypto if available
    else if (typeof require !== 'undefined') {
        try {
            const crypto = require('crypto');
            crypto.randomFillSync(array);
        }
        catch (e) {
            // Fallback to Math.random
            for (let i = 0; i < length; i++) {
                array[i] = Math.floor(Math.random() * 256);
            }
        }
    }
    // Fallback to Math.random
    else {
        for (let i = 0; i < length; i++) {
            array[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}
/**
 * Generate a new connection secret
 * @returns The connection secret
 */
export function newConnectionSecret() {
    return generateSecret(32);
}
//# sourceMappingURL=connectionSecret.js.map