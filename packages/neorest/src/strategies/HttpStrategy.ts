import { CommunicationStrategy, MsgWrapper, ClientStrategy, ConnectionInfo } from '@neorest/core';

/**
 * HTTP-based communication strategy using long polling
 */
export class HttpStrategy implements ClientStrategy {
  private connected = false;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private connectionInfo: ConnectionInfo;
  private authData: Record<string, string> = {};
  private pollDelay = 1000; // 1 second
  private pollFailures = 0;
  private maxPollFailures = 3;

  /**
   * Constructor
   * @param url - The URL to connect to
   */
  constructor(url: string) {
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url,
      type: 'http',
      status: 'disconnected'
    };
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    this.connected = true;
    this.connectionInfo.status = 'connected';
    this.pollForMessages();
    
    if (this.openCallback) {
      this.openCallback();
    }
    
    return Promise.resolve();
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.connected = false;
    this.connectionInfo.status = 'disconnected';
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    if (this.closeCallback) {
      this.closeCallback();
    }
  }

  /**
   * Send a message to the server
   * @param message - The message to send
   */
  async send(message: MsgWrapper): Promise<void> {
    if (!this.connected) {
      throw new Error("HTTP connection is not established");
    }

    try {
      // Add auth data to headers
      const headers: HeadersInit = { 
        'Content-Type': 'application/json' 
      };
      
      for (const [key, value] of Object.entries(this.authData)) {
        headers[key] = value;
      }
      
      const response = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      // Check if we have a response message
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseData = await response.json();
        if (responseData && this.messageCallback) {
          this.messageCallback(responseData as MsgWrapper);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  /**
   * Register a callback for when a message is received
   * @param callback - The callback to register
   */
  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback: () => void): void {
    this.openCallback = callback;
  }

  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set authentication data
   * @param authData - The authentication data
   */
  setAuthentication(authData: Record<string, string>): void {
    this.authData = authData;
  }

  /**
   * Get information about the connection
   * @returns Connection information
   */
  getConnectionInfo(): ConnectionInfo {
    return this.connectionInfo;
  }

  /**
   * Poll for messages from the server
   */
  private pollForMessages(): void {
    this.pollInterval = setInterval(async () => {
      if (!this.connected) {
        return;
      }
      
      try {
        // Add auth data to URL
        let pollUrl = new URL(this.connectionInfo.url);
        pollUrl.searchParams.set('poll', 'true');
        
        for (const [key, value] of Object.entries(this.authData)) {
          pollUrl.searchParams.set(key, value);
        }
        
        const response = await fetch(pollUrl.toString(), {
          headers: {
            'Accept': 'application/json',
            'X-Poll-ID': this.connectionInfo.id
          }
        });
        
        if (response.status === 204) {
          // No content, keep polling
          this.pollFailures = 0;
          return;
        }
        
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        
        // Reset failure counter on success
        this.pollFailures = 0;
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const message = await response.json() as MsgWrapper;
          if (this.messageCallback) {
            this.messageCallback(message);
          }
        }
      } catch (error) {
        console.error("Error polling for messages:", error);
        this.pollFailures++;
        
        if (this.pollFailures >= this.maxPollFailures) {
          console.error(`Max poll failures (${this.maxPollFailures}) reached, disconnecting`);
          this.disconnect();
        }
      }
    }, this.pollDelay);
  }
}