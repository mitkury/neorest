import { MsgWrapper, ConnectionSecret } from '@neorest/core';
import { HttpTransportBase } from '@neorest/router-core';

/**
 * HTTP long-polling transport for Node.js server
 */
export class HttpTransport extends HttpTransportBase {
  /**
   * Constructor
   * @param clientId - The client ID
   */
  constructor(clientId: string) {
    super(clientId);
  }
  
  // Node.js-specific methods can be added here as needed
}
