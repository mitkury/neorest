import { Router, RouterOptions } from '../core';
import { NodeServerAdapter, NodeServerAdapterOptions } from './adapters/NodeServerAdapter';
import type { NodeRequestHandlers } from './adapters/NodeServerAdapter';

/**
 * Node.js-specific router options
 */
export interface NodeRouterOptions extends RouterOptions, NodeServerAdapterOptions {}

/**
 * Node.js-specific router implementation
 */
export class NodeRouter extends Router {
  private adapter: NodeServerAdapter;

  /**
   * Constructor
   * @param options - Router options
   */
  constructor(options?: NodeRouterOptions) {
    super(options);
    
    this.adapter = new NodeServerAdapter(options);
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

  /**
   * Create composable Node request and upgrade handlers without opening a
   * separate port. The host server remains responsible for listening/closing.
   */
  public async createHandlers(): Promise<NodeRequestHandlers> {
    return this.adapter.createHandlers(this);
  }
}
