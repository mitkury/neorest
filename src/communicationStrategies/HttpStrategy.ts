import { CommunicationStrategy } from "./CommunicationStrategy.ts";
import { MsgWrapper } from "../types.ts";

// @TODO: it probably should be 'HttpClientStrategy' 
// where server http strategy will be different and will
// involve listening for requests using an http server.
export class HttpStrategy implements CommunicationStrategy {
  private connected = false;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private url: string) {}

  async connect(): Promise<void> {
    this.connected = true;
    this.pollForMessages();
    if (this.openCallback) {
      this.openCallback();
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.closeCallback) {
      this.closeCallback();
    }
  }

  async send(message: MsgWrapper): Promise<void> {
    if (!this.connected) {
      throw new Error("HTTP connection is not established");
    }

    // @TODO: send message to a route from the message if it's a route message
    // @TODO: look at the response and see if it's an ack for a message we sent
    await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onOpen(callback: () => void): void {
    this.openCallback = callback;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private pollForMessages(): void {
    this.pollInterval = setInterval(async () => {
      if (!this.connected) {
        return;
      }
      try {
        const response = await fetch(this.url);
        if (response.ok) {
          const message = await response.json() as MsgWrapper;
          if (this.messageCallback) {
            this.messageCallback(message);
          }
        }
      } catch (error) {
        console.error("Error polling for messages:", error);
        this.disconnect();
      }
    }, 1000); // Poll every second
  }
}