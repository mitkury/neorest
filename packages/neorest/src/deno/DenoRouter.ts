import { Router, RouterOptions } from '../core';
import { DenoServerAdapter, DenoServerAdapterOptions } from './adapters/DenoServerAdapter';

/**
 * Deno-specific router options that extend the base router options
 */
export interface DenoRouterOptions extends RouterOptions, DenoServerAdapterOptions {}

/**
 * Deno-specific router implementation
 */
export class DenoRouter extends Router {
  private adapter: DenoServerAdapter;

  /**
   * Constructor
   * @param options - Router options
   */
  constructor(options?: DenoRouterOptions) {
    super(options);
    
    this.adapter = new DenoServerAdapter(options);
    this.setServerAdapter(this.adapter);
  }

  /**
   * Start the server
   * @returns A promise that resolves when the server is started
   */
  public async listen(): Promise<void> {
    return super.listen();
  }

  /**
   * Stop the server
   */
  public async close(): Promise<void> {
    return super.close();
  }
}