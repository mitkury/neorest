var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/core/types.ts
var DATA_SET = "set";
function msg_ConnDataSet(key, value) {
  return {
    type: DATA_SET,
    key,
    value
  };
}
var PING = "ping";
var ON_ROUTE = "on";
function new_MsgSubscribeToRoute(route) {
  return {
    type: ON_ROUTE,
    route
  };
}
var OFF_ROUTE = "off";
function new_MsgUnsubscribeFromRoute(route) {
  return {
    type: OFF_ROUTE,
    route
  };
}
var RESPONSE = "res";
function new_MsgResponse(targetMsgId, status, data) {
  return {
    type: RESPONSE,
    target: targetMsgId,
    status,
    data
  };
}
function new_MsgResponseOK(targetMsgId, data) {
  return new_MsgResponse(targetMsgId, 200, data !== void 0 ? data : "OK");
}
function new_MsgResponseWithCode(targetMsgId, status, text) {
  return {
    type: RESPONSE,
    target: targetMsgId,
    status,
    data: text
  };
}
function new_MsgGenericError(targetMsgId, text) {
  return new_MsgResponseWithCode(targetMsgId, 500, text);
}
var ROUTE_MESSAGE = "route";
function new_MsgWrapper(id, msg) {
  return {
    id,
    msg,
    meta: {
      timestamp: Date.now(),
      version: "1.0.0"
    }
  };
}
function new_SendAndForgetMsgWrapper(msg) {
  return {
    // id: -1 means that the message doesn't have an identifier and doesn't expect a response.
    id: -1,
    msg,
    meta: {
      timestamp: Date.now(),
      version: "1.0.0"
    }
  };
}

// src/core/utils/TrackedPromise.ts
var TrackedPromise = class {
  /**
   * Constructor
   * @param promiseOrValue - A promise or a value
   */
  constructor(promiseOrValue) {
    this._isPending = true;
    this._isFulfilled = false;
    this._isRejected = false;
    this._original = promiseOrValue;
    if (promiseOrValue instanceof Promise) {
      this._promise = new Promise((resolve, reject) => {
        promiseOrValue.then(
          (value) => {
            this._isPending = false;
            this._isFulfilled = true;
            resolve(value);
          },
          (reason) => {
            this._isPending = false;
            this._isRejected = true;
            reject(reason);
          }
        );
      });
    } else {
      this._isPending = false;
      this._isFulfilled = true;
      this._promise = Promise.resolve(promiseOrValue);
    }
  }
  /**
   * Get the original promise or value
   * @returns The original promise or value
   */
  getOriginal() {
    return this._original;
  }
  /**
   * Check if the promise is pending
   */
  get isPending() {
    return this._isPending;
  }
  /**
   * Check if the promise is fulfilled
   */
  get isFulfilled() {
    return this._isFulfilled;
  }
  /**
   * Check if the promise is rejected
   */
  get isRejected() {
    return this._isRejected;
  }
  /**
   * Register callbacks for when the promise is fulfilled or rejected
   * @param onfulfilled - The callback for when the promise is fulfilled
   * @param onrejected - The callback for when the promise is rejected
   * @returns A new promise
   */
  then(onfulfilled, onrejected) {
    return this._promise.then(onfulfilled, onrejected);
  }
  /**
   * Register a callback for when the promise is rejected
   * @param onrejected - The callback for when the promise is rejected
   * @returns A new promise
   */
  catch(onrejected) {
    return this._promise.catch(onrejected);
  }
  /**
   * Register a callback that is called when the promise is settled
   * @param onfinally - The callback to call when the promise is settled
   * @returns A new promise
   */
  finally(onfinally) {
    return this._promise.finally(onfinally);
  }
};

// src/core/ConnectionBase.ts
var _ConnectionBase = class _ConnectionBase {
  /**
   * Constructor
   * @param strategy - The communication strategy to use
   */
  constructor(strategy) {
    this.nextMsgId = 0;
    this.messagesToAck = [];
    this.receivedMessages = [];
    this.messagesToSendAfterReconnect = [];
    this.callbacks = /* @__PURE__ */ new Map();
    this.messagesSentInASecond = 0;
    this.headers = {};
    this.messageHandlers = {};
    this.closingTimer = null;
    this.rateLimitInterval = null;
    // Event handlers
    this.onOpen = () => {
    };
    this.onClose = () => {
    };
    this.onDataSet = () => {
    };
    this.strategy = strategy;
    this.setupStrategyHandlers();
    this.setupRateLimiting();
    this.registerDefaultHandlers();
  }
  /**
   * Connect to the server
   */
  async connect() {
    await this.strategy.connect();
    this.onOpen();
  }
  /**
   * Close the connection
   */
  close() {
    this.clearClosingTimer();
    this.clearRateLimitInterval();
    this.strategy.disconnect();
  }
  /**
   * Set a new communication strategy
   * @param newStrategy - The new strategy to use
   */
  async setStrategy(newStrategy) {
    this.close();
    this.strategy = newStrategy;
    this.setupStrategyHandlers();
    await this.connect();
    this.sendMessagesFromLaterList();
  }
  /**
   * Post a message and register a callback for the response
   * @param msg - The message to post
   * @param callback - The callback to register
   */
  post(msg, callback) {
    const msgId = this.postAndExpectResponse(msg);
    if (callback) {
      this.callbacks.set(msgId, callback);
    }
  }
  /**
   * Get a header value
   * @param key - The header key
   * @returns The header value
   */
  getHeader(key) {
    return this.headers[key];
  }
  /**
   * Set a header value
   * @param key - The header key
   * @param value - The header value
   */
  setHeader(key, value) {
    this.headers[key] = value;
  }
  /**
   * Set up rate limiting
   */
  setupRateLimiting() {
    this.rateLimitInterval = setInterval(() => {
      this.messagesSentInASecond = 0;
    }, 1e3);
  }
  /**
   * Set up event handlers for the strategy
   */
  setupStrategyHandlers() {
    this.strategy.onMessage(this.handleSocketEvent.bind(this));
    this.strategy.onClose(() => {
      this.clearClosingTimer();
      this.onClose();
    });
    this.strategy.onOpen(() => {
      this.clearClosingTimer();
      this.onOpen();
    });
  }
  /**
   * Register default message handlers
   */
  registerDefaultHandlers() {
    this.messageHandlers[DATA_SET] = (id, msg) => {
      const dataSetMsg = msg;
      this.headers[dataSetMsg.key] = dataSetMsg.value;
      this.onDataSet([dataSetMsg.key, dataSetMsg.value]);
      return new_MsgResponseOK(id, [dataSetMsg.key, dataSetMsg.value]);
    };
    this.messageHandlers[PING] = (id) => {
      return new_MsgResponseOK(id, "pong");
    };
  }
  /**
   * Handle a socket event
   * @param wrapper - The message wrapper
   */
  handleSocketEvent(wrapper) {
    this.handleMessage(wrapper);
  }
  /**
   * Handle a message
   * @param wrapper - The message wrapper
   */
  handleMessage(wrapper) {
    const id = wrapper.id;
    const needsResponse = id !== -1;
    const msg = wrapper.msg;
    const alreadyReceived = needsResponse ? this.getReceivedPairById(id) : null;
    if (alreadyReceived) {
      if (alreadyReceived.response.isPending) {
        console.log("Message is being processed");
        this.postAndForget(new_MsgGenericError(id, "Message is being processed"));
      } else {
        this.postAndForget(alreadyReceived.response.getOriginal());
      }
      return;
    }
    let response = null;
    try {
      if (msg.type === RESPONSE) {
        this.handleResponse(msg);
      } else {
        const handler = this.messageHandlers[msg.type];
        if (handler) {
          const handlerResponse = handler(id, msg);
          if (handlerResponse !== null) {
            response = handlerResponse;
          }
        } else {
          console.error(`No handler for message type: ${msg.type}`);
          response = new_MsgGenericError(id, `Unknown message type: ${msg.type}`);
        }
      }
      if (needsResponse) {
        if (!response) {
          response = new_MsgGenericError(id, "No response");
        }
        this.postAndForget(response);
      }
    } catch (e) {
      if (needsResponse) {
        console.error("Error handling message", e);
        this.postAndForget(new_MsgGenericError(id, "Error handling message"));
      }
    }
    if (needsResponse) {
      if (response === null) {
        response = new_MsgGenericError(id, "No response");
      }
      this.receivedMessages.push({ wrapper, response: new TrackedPromise(response) });
    }
  }
  /**
   * Get a received message pair by ID
   * @param id - The message ID
   * @returns The message pair, or null if not found
   */
  getReceivedPairById(id) {
    for (let i = this.receivedMessages.length - 1; i >= 0; i--) {
      if (this.receivedMessages[i].wrapper.id === id) {
        return this.receivedMessages[i];
      }
    }
    return null;
  }
  /**
   * Handle a response message
   * @param msg - The response message
   */
  handleResponse(msg) {
    const msgId = msg.target;
    if (msg.status === 202) {
      return;
    }
    let response;
    if (msg.status >= 200 && msg.status < 300) {
      response = { data: msg.data, status: msg.status };
    } else {
      response = { error: msg.data, data: "", status: msg.status };
    }
    const callback = this.callbacks.get(msgId);
    if (callback) {
      callback(response);
      this.callbacks.delete(msgId);
    }
    this.removeMessageToAck(msgId);
  }
  /**
   * Send a message and expect a response
   * @param msg - The message to send
   * @returns The message ID
   */
  postAndExpectResponse(msg) {
    if (msg.type === RESPONSE) {
      throw new Error("Can't send a response that expects an acknowledge");
    }
    const id = this.nextMsgId++;
    const wrappedMsg = new_MsgWrapper(id, msg);
    if (this.strategy.isConnected()) {
      try {
        this.sendWrappedMsg(wrappedMsg);
      } catch (e) {
        console.error("Error sending message", e);
      }
    } else {
      this.messagesToSendAfterReconnect.push(wrappedMsg);
    }
    return id;
  }
  /**
   * Send a message and forget about the response
   * @param msgOrPromise - The message to send, or a promise that resolves to a message
   */
  async postAndForget(msgOrPromise) {
    const msg = await msgOrPromise;
    const wrappedMsg = new_SendAndForgetMsgWrapper(msg);
    if (this.strategy.isConnected()) {
      try {
        this.sendWrappedMsg(wrappedMsg);
      } catch (e) {
        console.error("Error sending message", e);
      }
    }
  }
  /**
   * Check if a message needs an acknowledgment
   * @param wrappedMsg - The message wrapper
   * @returns True if the message needs an acknowledgment, false otherwise
   */
  static messageNeedsAck(wrappedMsg) {
    return wrappedMsg.id !== -1 && wrappedMsg.msg.type !== RESPONSE;
  }
  /**
   * Send a wrapped message
   * @param wrappedMsg - The message wrapper
   * @param sentIdx - The index in the messagesToAck array, or -1 if not in the array
   */
  sendWrappedMsg(wrappedMsg, sentIdx = -1) {
    if (_ConnectionBase.messageNeedsAck(wrappedMsg)) {
      let targetIndex = sentIdx;
      if (sentIdx === -1) {
        for (let i = this.messagesToAck.length - 1; i >= 0; i--) {
          if (this.messagesToAck[i].wrappedMsg.id === wrappedMsg.id) {
            targetIndex = i;
            break;
          }
        }
      }
      if (targetIndex === -1) {
        this.messagesToAck.push({
          wrappedMsg,
          sentAt: Date.now(),
          sentAmount: 1
        });
      } else {
        this.messagesToAck[targetIndex].sentAmount++;
        this.messagesToAck[targetIndex].sentAt = Date.now();
      }
    }
    this.strategy.send(wrappedMsg);
  }
  /**
   * Remove a message from the messagesToAck array
   * @param id - The message ID
   */
  removeMessageToAck(id) {
    for (let i = this.messagesToAck.length - 1; i >= 0; i--) {
      if (this.messagesToAck[i].wrappedMsg.id === id) {
        this.messagesToAck.splice(i, 1);
        return;
      }
    }
  }
  /**
   * Send messages that were queued while disconnected
   */
  sendMessagesFromLaterList() {
    for (const msg of this.messagesToSendAfterReconnect) {
      this.sendWrappedMsg(msg);
    }
    this.messagesToSendAfterReconnect = [];
  }
  /**
   * Clear the closing timer
   */
  clearClosingTimer() {
    if (this.closingTimer) {
      clearTimeout(this.closingTimer);
      this.closingTimer = null;
    }
  }
  /**
   * Clear the rate limit interval
   */
  clearRateLimitInterval() {
    if (this.rateLimitInterval) {
      clearInterval(this.rateLimitInterval);
      this.rateLimitInterval = null;
    }
  }
  /**
   * Register a handler for a message type
   * @param type - The message type
   * @param handler - The handler function
   */
  registerHandler(type, handler) {
    this.messageHandlers[type] = handler;
  }
};
// Configuration
_ConnectionBase.RESEND_NOT_ANSWERED_MESSAGES_AFTER_MS = 3e3;
_ConnectionBase.SEND_LIMIT_PER_SEC = 100;
var ConnectionBase = _ConnectionBase;

// src/core/utils/connectionSecret.ts
function generateSecret(length) {
  const array = new Uint8Array(length);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(array);
  } else if (typeof __require !== "undefined") {
    try {
      const crypto = __require("crypto");
      crypto.randomFillSync(array);
    } catch (e) {
      for (let i = 0; i < length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
  } else {
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function newConnectionSecret() {
  return generateSecret(32);
}

// src/strategies/WebSocketStrategy.ts
var WebSocketStrategy = class {
  /**
   * Constructor
   * @param url - The URL to connect to
   */
  constructor(url) {
    this.socket = null;
    this.messageCallback = null;
    this.closeCallback = null;
    this.openCallback = null;
    this.authData = {};
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url,
      type: "websocket",
      status: "disconnected"
    };
  }
  /**
   * Connect to the server
   */
  async connect() {
    let connectionUrl = this.connectionInfo.url;
    if (Object.keys(this.authData).length > 0) {
      const urlObj = new URL(connectionUrl);
      for (const [key, value] of Object.entries(this.authData)) {
        urlObj.searchParams.set(key, value);
      }
      connectionUrl = urlObj.toString();
    }
    this.socket = new WebSocket(connectionUrl);
    this.connectionInfo.status = "connecting";
    this.setupSocketHandlers();
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("WebSocket not initialized"));
        return;
      }
      const onOpenHandler = () => {
        this.connectionInfo.status = "connected";
        resolve();
        if (this.socket) this.socket.removeEventListener("open", onOpenHandler);
      };
      const onErrorHandler = (event) => {
        this.connectionInfo.status = "disconnected";
        reject(new Error("WebSocket connection failed"));
        if (this.socket) this.socket.removeEventListener("error", onErrorHandler);
      };
      this.socket.addEventListener("open", onOpenHandler);
      this.socket.addEventListener("error", onErrorHandler);
    });
  }
  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (error) {
        console.error("Error closing WebSocket:", error);
      }
      this.socket = null;
    }
    this.connectionInfo.status = "disconnected";
  }
  /**
   * Send a message to the server
   * @param message - The message to send
   */
  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending message:", error);
        this.disconnect();
      }
    } else {
      throw new Error("WebSocket is not connected");
    }
  }
  /**
   * Register a callback for when a message is received
   * @param callback - The callback to register
   */
  onMessage(callback) {
    this.messageCallback = callback;
    if (this.socket) {
      const oldListener = this.socket.onmessage;
      if (oldListener) {
        this.socket.removeEventListener("message", oldListener);
      }
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.messageCallback(data);
        } catch (error) {
          console.error("Error parsing message:", error);
        }
      };
    }
  }
  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback) {
    this.closeCallback = callback;
    if (this.socket) {
      const oldListener = this.socket.onclose;
      if (oldListener) {
        this.socket.removeEventListener("close", oldListener);
      }
      this.socket.onclose = () => {
        this.connectionInfo.status = "disconnected";
        this.closeCallback();
      };
    }
  }
  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback) {
    this.openCallback = callback;
    if (this.socket) {
      const oldListener = this.socket.onopen;
      if (oldListener) {
        this.socket.removeEventListener("open", oldListener);
      }
      this.socket.onopen = () => {
        this.connectionInfo.status = "connected";
        this.openCallback();
      };
    }
  }
  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  /**
   * Set authentication data
   * @param authData - The authentication data
   */
  setAuthentication(authData) {
    this.authData = authData;
  }
  /**
   * Get information about the connection
   * @returns Connection information
   */
  getConnectionInfo() {
    return this.connectionInfo;
  }
  /**
   * Set up socket handlers
   */
  setupSocketHandlers() {
    if (!this.socket) return;
    if (this.messageCallback) {
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.messageCallback(data);
        } catch (error) {
          console.error("Error parsing message:", error);
        }
      };
    }
    if (this.closeCallback) {
      this.socket.onclose = () => {
        this.connectionInfo.status = "disconnected";
        this.closeCallback();
      };
    }
    if (this.openCallback) {
      this.socket.onopen = () => {
        this.connectionInfo.status = "connected";
        this.openCallback();
      };
    }
    this.socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }
};

// src/strategies/HttpStrategy.ts
var HttpStrategy = class {
  /**
   * Constructor
   * @param url - The URL to connect to
   */
  constructor(url) {
    this.connected = false;
    this.messageCallback = null;
    this.closeCallback = null;
    this.openCallback = null;
    this.pollInterval = null;
    this.authData = {};
    this.pollDelay = 1e3;
    // 1 second
    this.pollFailures = 0;
    this.maxPollFailures = 3;
    this.clientId = null;
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url,
      type: "http",
      status: "disconnected"
    };
  }
  /**
   * Connect to the server
   */
  async connect() {
    try {
      const url = new URL(this.connectionInfo.url);
      url.pathname = "/.neorest";
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { "Accept": "application/json" }
      });
      if (res.ok) {
        try {
          const data = await res.json();
          if (data && data.clientId) {
            this.clientId = data.clientId;
          }
        } catch {
        }
      }
    } catch (e) {
      console.error("HTTP strategy handshake failed, generating local clientId:", e);
    }
    if (!this.clientId) {
      this.clientId = Math.random().toString(36).slice(2);
    }
    this.connectionInfo.id = this.clientId;
    this.connected = true;
    this.connectionInfo.status = "connected";
    this.pollForMessages();
    if (this.openCallback) {
      this.openCallback();
    }
  }
  /**
   * Disconnect from the server
   */
  disconnect() {
    this.connected = false;
    this.connectionInfo.status = "disconnected";
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
  send(message) {
    if (!this.connected) {
      throw new Error("HTTP connection is not established");
    }
    const doSend = async () => {
      try {
        const headers = { "Content-Type": "application/json" };
        for (const [key, value] of Object.entries(this.authData)) {
          headers[key] = value;
        }
        const url = new URL(this.connectionInfo.url);
        url.pathname = "/.neorest";
        if (this.clientId) {
          url.searchParams.set("clientId", this.clientId);
        }
        const response = await fetch(url.toString(), {
          method: "POST",
          headers,
          body: JSON.stringify(message)
        });
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const responseData = await response.json();
          if (responseData && this.messageCallback) {
            if (Array.isArray(responseData)) {
              for (const msg of responseData) {
                this.messageCallback(msg);
              }
            } else {
              this.messageCallback(responseData);
            }
          }
        }
      } catch (error) {
        console.error("Error sending message:", error);
        throw error;
      }
    };
    void doSend();
  }
  /**
   * Register a callback for when a message is received
   * @param callback - The callback to register
   */
  onMessage(callback) {
    this.messageCallback = callback;
  }
  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback) {
    this.closeCallback = callback;
  }
  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback) {
    this.openCallback = callback;
  }
  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected() {
    return this.connected;
  }
  /**
   * Set authentication data
   * @param authData - The authentication data
   */
  setAuthentication(authData) {
    this.authData = authData;
  }
  /**
   * Get information about the connection
   * @returns Connection information
   */
  getConnectionInfo() {
    return this.connectionInfo;
  }
  /**
   * Poll for messages from the server
   */
  pollForMessages() {
    this.pollInterval = setInterval(async () => {
      if (!this.connected) return;
      try {
        const pollUrl = new URL(this.connectionInfo.url);
        pollUrl.pathname = "/.neorest";
        pollUrl.searchParams.set("poll", "true");
        if (this.clientId) {
          pollUrl.searchParams.set("clientId", this.clientId);
        }
        for (const [key, value] of Object.entries(this.authData)) {
          pollUrl.searchParams.set(key, value);
        }
        const response = await fetch(pollUrl.toString(), {
          headers: { "Accept": "application/json" }
        });
        if (response.status === 204) {
          this.pollFailures = 0;
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        this.pollFailures = 0;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const payload = await response.json();
          if (this.messageCallback) {
            if (Array.isArray(payload)) {
              for (const msg of payload) {
                this.messageCallback(msg);
              }
            } else {
              this.messageCallback(payload);
            }
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
};

// src/strategies/AutoStrategy.ts
var AutoStrategy = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.messageCallback = null;
    this.closeCallback = null;
    this.openCallback = null;
    this.authData = {};
    this.connectionSecret = null;
    this.http = new HttpStrategy(this.ensureHttpUrl(baseUrl));
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url: baseUrl,
      type: "http",
      status: "disconnected"
    };
  }
  async connect() {
    await this.http.connect();
    this.connectionInfo.status = "connected";
    this.connectionInfo.type = "http";
    if (this.messageCallback) this.http.onMessage(this.messageCallback);
    if (this.closeCallback) this.http.onClose(() => this.handleUnderlyingClose("http"));
    if (this.openCallback) this.http.onOpen(() => this.handleUnderlyingOpen("http"));
    if (this.openCallback) this.openCallback();
    setTimeout(() => {
      void this.tryUpgradeToWebSocket();
    }, 100);
  }
  disconnect() {
    try {
      this.ws?.disconnect();
    } catch {
    }
    try {
      this.http.disconnect();
    } catch {
    }
    this.connectionInfo.status = "disconnected";
  }
  send(message) {
    if (this.ws && this.ws.isConnected()) {
      try {
        this.ws.send(message);
        this.connectionInfo.type = "websocket";
        return;
      } catch (e) {
      }
    }
    this.http.send(message);
    this.connectionInfo.type = "http";
  }
  onMessage(callback) {
    this.messageCallback = callback;
    this.http.onMessage(callback);
    if (this.ws) this.ws.onMessage(callback);
  }
  onClose(callback) {
    this.closeCallback = callback;
    this.http.onClose(() => this.handleUnderlyingClose("http"));
    if (this.ws) this.ws.onClose(() => this.handleUnderlyingClose("ws"));
  }
  onOpen(callback) {
    this.openCallback = callback;
    this.http.onOpen(() => this.handleUnderlyingOpen("http"));
    if (this.ws) this.ws.onOpen(() => this.handleUnderlyingOpen("ws"));
  }
  isConnected() {
    return (this.ws?.isConnected?.() ?? false) || this.http.isConnected();
  }
  setAuthentication(authData) {
    this.authData = authData;
    this.http.setAuthentication(authData);
    if (this.ws) this.ws.setAuthentication(authData);
  }
  setConnectionSecret(secret) {
    this.connectionSecret = secret;
    if (this.http.setConnectionSecret) {
      this.http.setConnectionSecret(secret);
    }
  }
  getConnectionInfo() {
    return {
      ...this.connectionInfo,
      url: this.baseUrl,
      status: this.isConnected() ? "connected" : "disconnected",
      type: this.ws?.isConnected() ? "websocket" : "http"
    };
  }
  // Internals
  async tryUpgradeToWebSocket() {
    try {
      let wsUrl = this.ensureWsUrl(this.baseUrl);
      if (this.connectionSecret) {
        const url = new URL(wsUrl);
        url.searchParams.set("secret", this.connectionSecret);
        wsUrl = url.toString();
      }
      const ws = new WebSocketStrategy(wsUrl);
      if (Object.keys(this.authData).length > 0) ws.setAuthentication(this.authData);
      if (this.messageCallback) ws.onMessage(this.messageCallback);
      if (this.openCallback) ws.onOpen(() => this.handleUnderlyingOpen("ws"));
      if (this.closeCallback) ws.onClose(() => this.handleUnderlyingClose("ws"));
      await ws.connect();
      this.ws = ws;
      this.connectionInfo.type = "websocket";
      if (this.openCallback) this.openCallback();
    } catch (e) {
    }
  }
  handleUnderlyingOpen(kind) {
    if (kind === "ws") {
      this.connectionInfo.type = "websocket";
    } else if (!this.ws || !this.ws.isConnected()) {
      this.connectionInfo.type = "http";
    }
  }
  handleUnderlyingClose(kind) {
    const wsConnected = this.ws?.isConnected() ?? false;
    const httpConnected = this.http.isConnected();
    if (!wsConnected && !httpConnected) {
      if (this.closeCallback) this.closeCallback();
      this.connectionInfo.status = "disconnected";
    }
  }
  ensureHttpUrl(url) {
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("ws://")) return "http://" + url.slice("ws://".length);
    if (url.startsWith("wss://")) return "https://" + url.slice("wss://".length);
    return url;
  }
  ensureWsUrl(url) {
    if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
    if (url.startsWith("https://")) return "wss://" + url.slice("https://".length);
    if (url.startsWith("http://")) return "ws://" + url.slice("http://".length);
    return "ws://" + url;
  }
};

// src/strategies/index.ts
function createStrategy(type, url) {
  if (type === "websocket") return new WebSocketStrategy(url);
  if (type === "http") return new HttpStrategy(url);
  return new AutoStrategy(url);
}

// src/ClientConnection.ts
var ClientConnection = class extends ConnectionBase {
  /**
   * Constructor
   * @param strategy - The communication strategy to use
   * @param options - Options for the connection
   */
  constructor(strategy, options) {
    super(strategy);
    this.isFullyConnected = false;
    this.subscribedRoutes = {};
    this.reconnectTimer = null;
    this.defaultRequestHeaders = {};
    /**
     * Event called when client is connected
     */
    this.onClientConnect = () => {
    };
    this.setHeader("secret", newConnectionSecret());
    if (strategy.setConnectionSecret) {
      const secret = this.getSecret();
      if (secret) {
        strategy.setConnectionSecret(secret);
      }
    }
    this.onClientConnect = () => {
      const secret = this.getSecret();
      if (secret) {
        this.postAndForget(msg_ConnDataSet("secret", secret));
      }
    };
    this.reconnectOptions = {
      maxAttempts: 10,
      initialDelay: 500,
      maxDelay: 3e4,
      factor: 1.5,
      ...typeof options?.reconnect === "object" ? options.reconnect : {}
    };
    this.registerRouteMessageHandler();
    this.setupConnectionHandlers();
  }
  /**
   * Set the URL for the connection
   * @param url - The URL to connect to
   * @param strategyType - The type of strategy to use
   */
  async setUrl(url, strategyType) {
    this.url = url;
    this.close();
    const type = strategyType || this.getStrategyType();
    const strategy = createStrategy(type, url);
    if (type === "auto" && strategy.setConnectionSecret) {
      const secret = this.getSecret();
      console.log(`ClientConnection.setUrl: setting secret on auto strategy: ${secret}`);
      if (secret) {
        strategy.setConnectionSecret(secret);
      }
    }
    this.setStrategy(strategy);
    await this.connect();
  }
  /**
   * Check if the connection is fully established
   * @returns True if connected, false otherwise
   */
  isConnected() {
    return this.isFullyConnected;
  }
  /**
   * Get the connection secret
   * @returns The connection secret
   */
  getSecret() {
    return this.getHeader("secret") || "";
  }
  /**
   * Get the strategy type
   * @returns The strategy type
   */
  getStrategyType() {
    const type = this.strategy.type;
    if (type === "websocket" || type === "http" || type === "auto") {
      return type;
    }
    return "auto";
  }
  /**
   * Send a message to a route
   * @param route - The route to send to
   * @param verb - The HTTP verb to use
   * @param payload - The payload to send
   * @param headers - Optional headers
   * @param callback - Optional callback for the response
   */
  sendToRoute(route, verb, payload, headers, callback) {
    this.validateRoute(route);
    if (this.messagesSentInASecond > ConnectionBase.SEND_LIMIT_PER_SEC) {
      callback?.({
        error: `Rate limit of ${ConnectionBase.SEND_LIMIT_PER_SEC} messages per second exceeded`,
        data: null
      });
      return;
    }
    const mergedHeaders = { ...this.defaultRequestHeaders, ...headers || {} };
    const msg = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload !== void 0 ? payload : "",
      headers: Object.keys(mergedHeaders).length ? mergedHeaders : void 0
    };
    const msgId = this.postAndExpectResponse(msg);
    this.messagesSentInASecond++;
    if (callback) {
      this.callbacks.set(msgId, callback);
    }
  }
  /**
   * Send a message to a route without expecting a response
   * @param route - The route to send to
   * @param verb - The HTTP verb to use
   * @param payload - The payload to send
   * @param headers - Optional headers
   */
  sendToRouteAndForget(route, verb, payload, headers) {
    this.validateRoute(route);
    const mergedHeaders = { ...this.defaultRequestHeaders, ...headers || {} };
    const msg = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload,
      headers: Object.keys(mergedHeaders).length ? mergedHeaders : void 0
    };
    this.postAndForget(msg);
  }
  /**
   * Subscribe to a route
   * @param route - The route to subscribe to
   * @param callback - The callback to call when a message is received on the route
   * @returns A promise that resolves when the subscription is established
   */
  on(route, callback) {
    return this.connSubscribe(route, callback);
  }
  connSubscribe(route, callback) {
    return new Promise(async (resolve, reject) => {
      if (this.subscribedRoutes[route]) {
        const errorMsg = `Route "${route}" already has a subscription`;
        console.error(errorMsg);
        reject(new Error(errorMsg));
        return;
      }
      this.subscribedRoutes[route] = callback;
      let waitCount = 0;
      while (true) {
        if (this.isFullyConnected) {
          break;
        }
        waitCount++;
        if (waitCount > 50) {
          console.error(`ClientConnection: Timeout waiting for connection to subscribe to ${route}`);
          reject(new Error(`Connection timeout for subscription to ${route}`));
          return;
        }
        await new Promise((resolve2) => setTimeout(resolve2, 100));
      }
      this.post(new_MsgSubscribeToRoute(route), (response) => {
        if (response.error) {
          const errorMsg = `Failed to subscribe to route "${route}": ${response.error}`;
          console.error(errorMsg);
          delete this.subscribedRoutes[route];
          reject(new Error(errorMsg));
        } else {
          resolve();
        }
      });
    });
  }
  /**
   * Unsubscribe from a route
   * @param route - The route to unsubscribe from
   */
  off(route) {
    this.post(new_MsgUnsubscribeFromRoute(route), (response) => {
      if (response.error) {
        console.error(`Failed to unsubscribe from route "${route}": ${response.error}`);
        return;
      }
    });
    delete this.subscribedRoutes[route];
  }
  /**
   * Validate a route
   * @param route - The route to validate
   * @throws Error if the route is invalid
   */
  validateRoute(route) {
    if (!/^[a-zA-Z0-9_\/-]+$/.test(route)) {
      if (route.includes(":")) {
        throw new Error(`Route "${route}" contains colons ':' which is not allowed. Colons are reserved for route parameters.`);
      }
      throw new Error(`Route "${route}" contains invalid characters. Only alphanumeric characters, forward slashes, dashes and underscores are allowed.`);
    }
  }
  /**
   * Set up connection handlers
   */
  setupConnectionHandlers() {
    const originalOnOpen = this.onOpen;
    this.onOpen = () => {
      originalOnOpen();
      this.isFullyConnected = true;
      this.onClientConnect();
    };
    const originalOnClose = this.onClose;
    this.onClose = () => {
      originalOnClose();
      this.isFullyConnected = false;
      this.scheduleReconnect();
    };
  }
  /**
   * Register the route message handler
   */
  registerRouteMessageHandler() {
    this.registerHandler(ROUTE_MESSAGE, (_, msg) => {
      const routeMsg = msg;
      const sub = this.subscribedRoutes[routeMsg.route];
      if (sub) {
        const action = routeMsg.verb;
        sub({ data: routeMsg.data, action });
      }
      return new_MsgResponseOK(_, "ok");
    });
  }
  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.reconnectOptions) {
      console.error("Connection closed, re-connecting...");
      this.reconnectTimer = setTimeout(() => this.reconnect(), this.reconnectOptions.initialDelay);
    }
  }
  /**
   * Attempt to reconnect
   */
  async reconnect() {
    if (!this.url) {
      return;
    }
    try {
      const strategyType = this.getStrategyType();
      const strategy = createStrategy(strategyType, this.url);
      if (strategyType === "auto" && strategy.setConnectionSecret) {
        const secret = this.getSecret();
        console.log(`ClientConnection.reconnect: setting secret on auto strategy: ${secret}`);
        if (secret) {
          strategy.setConnectionSecret(secret);
        }
      }
      this.setStrategy(strategy);
      await this.connect();
      this.resubscribeToRoutes();
    } catch (error) {
      console.error("Reconnection failed:", error);
      const initialDelay = this.reconnectOptions?.initialDelay || 500;
      const factor = this.reconnectOptions?.factor || 1.5;
      const maxDelay = this.reconnectOptions?.maxDelay || 3e4;
      const nextDelay = Math.min(
        initialDelay * Math.pow(factor, 1),
        maxDelay
      );
      this.reconnectTimer = setTimeout(() => this.reconnect(), nextDelay);
    }
  }
  /**
   * Resubscribe to all routes
   */
  resubscribeToRoutes() {
    for (const route in this.subscribedRoutes) {
      this.post(new_MsgSubscribeToRoute(route), (response) => {
        if (response.error) {
          console.error(`Failed to resubscribe to route "${route}"`, response.error);
        }
      });
    }
  }
  setDefaultHeaders(headers) {
    this.defaultRequestHeaders = { ...headers };
  }
};

// src/Client.ts
var Client = class {
  /**
   * Constructor
   * @param url - The URL to connect to
   * @param strategyType - The type of strategy to use
   * @param options - Options for the connection
   */
  constructor(url, strategyType = "auto", options) {
    if (!url) {
      throw new Error("URL is required to create a client connection");
    }
    const strategy = createStrategy(strategyType, url);
    this.conn = new ClientConnection(strategy, options);
  }
  /**
   * Get the URL of the connection
   * @returns The URL
   */
  getURL() {
    return this.conn.getHeader("url");
  }
  /**
   * Check if the client is connected
   * @returns True if connected, false otherwise
   */
  isConnected() {
    return this.conn.isConnected();
  }
  /**
   * Set the URL of the connection
   * @param url - The URL to connect to
   * @param strategyType - The type of strategy to use
   * @returns A promise that resolves when the connection is established
   */
  async setUrl(url, strategyType) {
    return this.conn.setUrl(url, strategyType);
  }
  /**
   * Close the connection
   */
  close() {
    this.conn.close();
  }
  /**
   * Send a GET request to a route
   * @param route - The route to send to
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  get(route, headers) {
    return this.sendToRoute(route, "GET", "", headers);
  }
  /**
   * Send a DELETE request to a route
   * @param route - The route to send to
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  delete(route, headers) {
    return this.sendToRoute(route, "DELETE", "", headers);
  }
  /**
   * Send a POST request to a route
   * @param route - The route to send to
   * @param payload - The payload to send
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  post(route, payload, headers) {
    return this.sendToRoute(route, "POST", payload, headers);
  }
  /**
   * Send a POST request to a route without expecting a response
   * @param route - The route to send to
   * @param payload - The payload to send
   * @param headers - Optional headers
   */
  postAndForget(route, payload, headers) {
    this.conn.sendToRouteAndForget(route, "POST", payload !== void 0 ? payload : "", headers);
  }
  /**
   * Set the Authorization Bearer token to be sent on all requests
   */
  setAuthToken(token) {
    this.conn.setDefaultHeaders({ Authorization: `Bearer ${token}` });
  }
  /**
   * Clear any default Authorization token
   */
  clearAuthToken() {
    this.conn.setDefaultHeaders({});
  }
  /**
   * Send a request to a route
   * @param route - The route to send to
   * @param verb - The HTTP verb to use
   * @param payload - The payload to send
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  sendToRoute(route, verb, payload, headers) {
    return new Promise((resolve) => {
      this.conn.sendToRoute(route, verb, payload !== void 0 ? payload : "", headers, (response) => {
        resolve(response);
      });
    });
  }
  /**
   * Subscribe to a route
   * @param route - The route to subscribe to
   * @param callback - The callback to call when a message is received on the route
   * @returns A promise that resolves when the subscription is established
   */
  on(route, callback) {
    return this.conn.on(route, callback);
  }
  /**
   * Unsubscribe from a route
   * @param route - The route to unsubscribe from
   */
  off(route) {
    this.conn.off(route);
  }
};

export { AutoStrategy, Client, ClientConnection, HttpStrategy, WebSocketStrategy, createStrategy };
//# sourceMappingURL=mod.js.map
//# sourceMappingURL=mod.js.map