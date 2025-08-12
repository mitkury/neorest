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
  private clientId: string | null = null;

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
    // Perform handshake to obtain a clientId from the server
    try {
      const url = new URL(this.connectionInfo.url);
      url.pathname = '/.neorest';
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (res.ok) {
        // Server returns { clientId } when no clientId is provided
        try {
          const data = await res.json() as { clientId?: string };
          if (data && data.clientId) {
            this.clientId = data.clientId;
          }
        } catch {
          // If response isn't JSON, fall back to generated id below
        }
      }
    } catch (e) {
      // Handshake failed; proceed with a locally generated id to avoid blocking
      console.error('HTTP strategy handshake failed, generating local clientId:', e);
    }

    if (!this.clientId) {
      this.clientId = Math.random().toString(36).slice(2);
    }
    this.connectionInfo.id = this.clientId;

    this.connected = true;
    this.connectionInfo.status = 'connected';
    this.pollForMessages();

    if (this.openCallback) {
      this.openCallback();
    }
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
  send(message: MsgWrapper): void {
    if (!this.connected) {
      throw new Error('HTTP connection is not established');
    }

    const doSend = async () => {
      try {
        // Add auth data to headers
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        for (const [key, value] of Object.entries(this.authData)) {
          (headers as any)[key] = value;
        }

        // Include clientId in URL
        const url = new URL(this.connectionInfo.url);
        url.pathname = '/.neorest';
        if (this.clientId) {
          url.searchParams.set('clientId', this.clientId);
        }

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        // Handle immediate response message if present
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const responseData = await response.json();
          if (responseData && this.messageCallback) {
            if (Array.isArray(responseData)) {
              for (const msg of responseData) {
                this.messageCallback(msg as MsgWrapper);
              }
            } else {
              this.messageCallback(responseData as MsgWrapper);
            }
          }
        }
      } catch (error) {
        console.error('Error sending message:', error);
        throw error;
      }
    };

    // Fire-and-forget to comply with interface signature
    void doSend();
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
      if (!this.connected) return;

      try {
        // Build poll URL with clientId and auth
        const pollUrl = new URL(this.connectionInfo.url);
        pollUrl.pathname = '/.neorest';
        pollUrl.searchParams.set('poll', 'true');
        if (this.clientId) {
          pollUrl.searchParams.set('clientId', this.clientId);
        }
        for (const [key, value] of Object.entries(this.authData)) {
          pollUrl.searchParams.set(key, value);
        }

        const response = await fetch(pollUrl.toString(), {
          headers: { 'Accept': 'application/json' }
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
          const payload = await response.json();
          if (this.messageCallback) {
            if (Array.isArray(payload)) {
              for (const msg of payload) {
                this.messageCallback(msg as MsgWrapper);
              }
            } else {
              this.messageCallback(payload as MsgWrapper);
            }
          }
        }
      } catch (error) {
        console.error('Error polling for messages:', error);
        this.pollFailures++;

        if (this.pollFailures >= this.maxPollFailures) {
          console.error(`Max poll failures (${this.maxPollFailures}) reached, disconnecting`);
          this.disconnect();
        }
      }
    }, this.pollDelay);
  }
}