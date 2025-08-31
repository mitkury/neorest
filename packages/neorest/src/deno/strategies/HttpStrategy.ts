import { MsgWrapper, ConnectionSecret } from '../../core';
import { HttpStrategyBase } from '../../core';

/**
 * HTTP long-polling strategy for Deno server
 */
export class HttpStrategy extends HttpStrategyBase {
  /**
   * Constructor
   * @param clientId - The client ID
   */
  constructor(clientId: string) {
    super(clientId);
  }
  
  // Deno-specific methods can be added here if needed
}