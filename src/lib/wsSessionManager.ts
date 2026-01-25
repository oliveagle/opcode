/**
 * WebSocket Session Manager
 * Creates isolated WebSocket connections per tab for message isolation
 */

type MessageHandler = (data: any) => void;

interface WSSession {
  id: string;
  ws: WebSocket;
  handlers: Set<MessageHandler>;
  isConnected: boolean;
}

class WebSocketSessionManager {
  private sessions: Map<string, WSSession> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 1000;

  /**
   * Create or get a WebSocket session for a specific tab
   */
  getOrCreateSession(tabId: string, sessionId?: string): WSSession {
    let session = this.sessions.get(tabId);

    if (!session || session.ws.readyState === WebSocket.CLOSED) {
      session = this.createSession(tabId, sessionId);
      this.sessions.set(tabId, session);
    }

    return session;
  }

  private createSession(tabId: string, sessionId?: string): WSSession {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use tabId as the WebSocket session ID for isolation
    const wsSessionId = sessionId || tabId;
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/claude?session_id=${wsSessionId}`;

    console.log(`[WS Manager] Creating session for tab ${tabId} with ID ${wsSessionId}`);
    const ws = new WebSocket(wsUrl);

    const session: WSSession = {
      id: wsSessionId,
      ws,
      handlers: new Set(),
      isConnected: false,
    };

    ws.onopen = () => {
      console.log(`[WS Manager] Connection opened for tab ${tabId}`);
      session.isConnected = true;
      this.reconnectAttempts.set(tabId, 0);
    };

    ws.onmessage = (event) => {
      console.log(`[WS Manager] Message for tab ${tabId}:`, event.data);
      try {
        const message = JSON.parse(event.data);
        // Route message only to this tab's handlers
        session.handlers.forEach(handler => handler(message));
      } catch (e) {
        console.error(`[WS Manager] Failed to parse message for tab ${tabId}:`, e);
      }
    };

    ws.onerror = (error) => {
      console.error(`[WS Manager] WebSocket error for tab ${tabId}:`, error);
    };

    ws.onclose = (event) => {
      console.log(`[WS Manager] Connection closed for tab ${tabId}, code: ${event.code}`);
      session.isConnected = false;

      // Auto-reconnect
      if (event.code !== 1000 && event.code !== 1001) {
        this.attemptReconnect(tabId, sessionId);
      }
    };

    return session;
  }

  private attemptReconnect(tabId: string, sessionId?: string) {
    const attempts = (this.reconnectAttempts.get(tabId) || 0) + 1;

    if (attempts > this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`[WS Manager] Max reconnect attempts reached for tab ${tabId}`);
      return;
    }

    this.reconnectAttempts.set(tabId, attempts);
    console.log(`[WS Manager] Reconnecting tab ${tabId}, attempt ${attempts}`);

    setTimeout(() => {
      const session = this.createSession(tabId, sessionId);
      this.sessions.set(tabId, session);
    }, this.RECONNECT_DELAY * attempts);
  }

  /**
   * Register a message handler for a specific tab
   */
  registerHandler(tabId: string, handler: MessageHandler): () => void {
    const session = this.getOrCreateSession(tabId);
    session.handlers.add(handler);

    // Return unregister function
    return () => {
      session.handlers.delete(handler);
    };
  }

  /**
   * Send a message through a specific tab's connection
   */
  send(tabId: string, message: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(tabId);

      if (!session || session.ws.readyState !== WebSocket.OPEN) {
        // Create new connection if needed
        const newSession = this.getOrCreateSession(tabId);

        // Wait for connection
        const checkOpen = () => {
          if (newSession.ws.readyState === WebSocket.OPEN) {
            newSession.ws.send(JSON.stringify(message));
            resolve();
          } else if (newSession.ws.readyState === WebSocket.CONNECTING) {
            setTimeout(checkOpen, 50);
          } else {
            reject(new Error('WebSocket connection failed'));
          }
        };
        checkOpen();
        return;
      }

      session.ws.send(JSON.stringify(message));
      resolve();
    });
  }

  /**
   * Close a specific tab's connection
   */
  close(tabId: string) {
    const session = this.sessions.get(tabId);
    if (session) {
      session.ws.close(1000, 'Tab closed');
      session.handlers.clear();
      this.sessions.delete(tabId);
      console.log(`[WS Manager] Closed session for tab ${tabId}`);
    }
  }

  /**
   * Close all connections
   */
  closeAll() {
    this.sessions.forEach((session) => {
      session.ws.close(1000, 'All sessions closed');
    });
    this.sessions.clear();
    console.log('[WS Manager] Closed all sessions');
  }

  /**
   * Get session status
   */
  getSessionStatus(tabId: string): string {
    const session = this.sessions.get(tabId);
    if (!session) return 'none';
    if (session.isConnected) return 'connected';
    if (session.ws.readyState === WebSocket.CONNECTING) return 'connecting';
    return 'disconnected';
  }
}

// Singleton instance
export const wsManager = new WebSocketSessionManager();
