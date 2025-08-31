import { createServer } from 'net';

/**
 * Port allocation utility for tests
 */
class PortManager {
  private static instance: PortManager;
  private currentPort: number = 8000;
  private readonly maxPort: number = 8999;
  private readonly maxAttempts: number = 100;

  private constructor() {}

  static getInstance(): PortManager {
    if (!PortManager.instance) {
      PortManager.instance = new PortManager();
    }
    return PortManager.instance;
  }

  /**
   * Check if a port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      
      server.listen(port, () => {
        server.once('close', () => {
          resolve(true);
        });
        server.close();
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Get the next available port
   */
  async getNextPort(): Promise<number> {
    let attempts = 0;
    
    while (attempts < this.maxAttempts) {
      if (this.currentPort > this.maxPort) {
        this.currentPort = 8000; // Reset to beginning
      }
      
      // Use a random offset to avoid conflicts in parallel execution
      const randomOffset = Math.floor(Math.random() * 100);
      const port = this.currentPort + randomOffset;
      this.currentPort++;
      
      // Try to actually bind to the port to ensure it's truly available
      try {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.listen(port, () => {
            server.close(() => {
              resolve();
            });
          });
          server.on('error', reject);
        });
        return port;
      } catch (error) {
        // Port is not available, try the next one
        attempts++;
        continue;
      }
    }
    
    throw new Error(`Could not find available port after ${this.maxAttempts} attempts`);
  }

  /**
   * Reset the port counter (useful for test cleanup)
   */
  reset(): void {
    this.currentPort = 8000;
  }

  /**
   * Get the current port without incrementing
   */
  getCurrentPort(): number {
    return this.currentPort;
  }
}

// Export the singleton instance
export const portManager = PortManager.getInstance();
