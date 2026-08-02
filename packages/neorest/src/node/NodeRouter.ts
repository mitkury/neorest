import { Router, RouterOptions } from '../core';
import { NodeServerAdapter, NodeServerAdapterOptions } from './adapters/NodeServerAdapter';
import type { NodeRequestHandlers } from './adapters/NodeServerAdapter';

/** Structural boundary for optional Node WebRTC implementations such as wrtc. */
export interface NodeWebRtcProvider {
  RTCPeerConnection: new (configuration?: RTCConfiguration) => object;
}

/**
 * Node.js-specific router options
 */
export interface NodeRouterOptions extends RouterOptions, NodeServerAdapterOptions {
  /**
   * Node has no built-in RTCPeerConnection. Pass an installed WebRTC runtime;
   * Neorest then owns signaling and peer lifecycle.
   */
  webRtc?: NodeWebRtcProvider;
}

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
    const createLivePeerConnection = options?.createLivePeerConnection
      || (options?.webRtc
        ? (configuration: RTCConfiguration) => (
          new options.webRtc!.RTCPeerConnection(configuration) as RTCPeerConnection
        )
        : undefined);
    super({ ...options, createLivePeerConnection });
    
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
