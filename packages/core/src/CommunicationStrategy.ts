import { MsgWrapper, BaseConnection } from './types.js';

/**
 * Base communication strategy interface
 */
export interface CommunicationStrategy {
  /**
   * Connect to the server
   */
  connect(): Promise<void>;
  
  /**
   * Disconnect from the server
   */
  disconnect(): void;
  
  /**
   * Send a message
   * @param message - The message to send
   */
  send(message: MsgWrapper): void;
  
  /**
   * Register a callback for when a message is received
   * @param callback - The callback to register
   */
  onMessage(callback: (message: MsgWrapper) => void): void;
  
  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback: () => void): void;
  
  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback: () => void): void;
  
  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean;
}

/**
 * Strategy for client-side communication
 */
export interface ClientStrategy extends CommunicationStrategy {
  /**
   * Set authentication data
   * @param authData - The authentication data
   */
  setAuthentication(authData: Record<string, string>): void;
  
  /**
   * Get information about the connection
   * @returns Connection information
   */
  getConnectionInfo(): ConnectionInfo;
}

/**
 * Strategy for server-side communication
 */
export interface ServerStrategy extends CommunicationStrategy {
  /**
   * Handle a new connection
   * @param connection - The connection to handle
   */
  handleConnection(connection: BaseConnection): void;
  
  /**
   * Broadcast a message to all connections
   * @param message - The message to broadcast
   * @param filter - Optional filter function to determine which connections receive the message
   */
  broadcast(message: MsgWrapper, filter?: (conn: BaseConnection) => boolean): void;
}

/**
 * Information about a connection
 */
export interface ConnectionInfo {
  id: string;
  url: string;
  type: 'websocket' | 'http' | 'sse';
  status: 'connecting' | 'connected' | 'disconnected';
}