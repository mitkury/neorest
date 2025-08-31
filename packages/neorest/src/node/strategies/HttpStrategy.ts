import { MsgWrapper, ConnectionSecret } from '../../core';
import { HttpStrategyBase } from '../../core';

/**
 * HTTP long-polling strategy for Node.js server
 */
export class HttpStrategy extends HttpStrategyBase {
  /**
   * Constructor
   * @param clientId - The client ID
   */
  constructor(clientId: string) {
    super(clientId);
  }
  
  // Node.js-specific methods can be added here as needed
}