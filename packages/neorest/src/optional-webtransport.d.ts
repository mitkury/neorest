declare module '@fails-components/webtransport' {
  export const Http3Server: new (options: Record<string, unknown>) => unknown;
  export const quicheLoaded: Promise<unknown>;
}

declare module '@fails-components/webtransport-transport-http3-quiche';
