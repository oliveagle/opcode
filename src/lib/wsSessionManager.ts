/**
 * WebSocket Session Manager
 * Creates isolated WebSocket connections per tab for message isolation
 */
import { clientLog } from './apiAdapter';

type MessageHandler = (data: any) => void;

interface WSSession {
  id: string;
  ws: WebSocket;
  handlers: Set<MessageHandler>;
  isConnected: boolean;
  isStale: boolean; // Mark connection as stale when close is initiated
}

// Global state to survive module re-initialization
interface WsSessionState {
  sessions: Map<string, WSSession>;
  reconnectAttempts: Map<string, number>;
}

const globalState: WsSessionState = (globalThis as any).__WS_SESSION_STATE__ || {
  sessions: new Map<string, WSSession>(),
  reconnectAttempts: new Map<string, number>(),
};

// Store in globalThis to survive module re-initialization
if (!(globalThis as any).__WS_SESSION_STATE__) {
  (globalThis as any).__WS_SESSION_STATE__ = globalState;
}

class WebSocketSessionManager {
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 1000;

  /**
   * Create or get a WebSocket session for a specific tab
   */
  getOrCreateSession(tabId: string, sessionId?: string): WSSession {
    const sessions = globalState.sessions;
    let session = sessions.get(tabId);

    // Determine if a new session is needed:
    // - No session exists
    // - Session is marked stale (previous close not yet processed)
    // - Connection is closed (WebSocket readyState === CLOSED)
    // Note: We always create a new connection if the existing one is closed,
    // because a closed WebSocket cannot be reused.
    const isClosed = session?.ws?.readyState === WebSocket.CLOSED;
    const needsNewSession = !session || session.isStale || isClosed;

    clientLog('wsManager', `getOrCreateSession tab=${tabId} exists=${!!session} stale=${session?.isStale} closed=${isClosed} needsNew=${needsNewSession}`);

    // Create new session if: no session exists, or session is stale/closed
    if (needsNewSession) {
      // Transfer handlers from old session to new session to preserve event listeners
      const oldHandlers = session ? Array.from(session.handlers) : [];

      session = this.createSession(tabId, sessionId);

      // Restore handlers to the new session
      if (oldHandlers.length > 0) {
        clientLog('wsManager', `Restoring ${oldHandlers.length} handlers to new session for tab ${tabId}`);
        oldHandlers.forEach(handler => session!.handlers.add(handler));
      }

      sessions.set(tabId, session);
    }

    return session!;
  }

  private createSession(tabId: string, sessionId?: string): WSSession {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use tabId as the WebSocket session ID for isolation
    const wsSessionId = sessionId || tabId;
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/claude?session_id=${wsSessionId}`;

    clientLog('wsManager', `CREATING SESSION tabId=${tabId} sessionId=${sessionId} wsSessionId=${wsSessionId} url=${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    const session: WSSession = {
      id: wsSessionId,
      ws,
      handlers: new Set(),
      isConnected: false,
      isStale: false,
    };

    // Use addEventListener instead of onXxx properties to allow multiple handlers
    ws.addEventListener('open', () => {
      clientLog('wsManager', `Connection opened for tab ${tabId}`);
      session.isConnected = true;
      session.isStale = false; // Reset stale flag when connection opens successfully
      globalState.reconnectAttempts.set(tabId, 0);
    });

    ws.addEventListener('message', (event) => {
      clientLog('wsManager', `Message for tab ${tabId}: ${String(event.data).substring(0, 100)}`);
      try {
        const message = JSON.parse(event.data);
        // Route message only to this tab's handlers
        session.handlers.forEach(handler => handler(message));
      } catch (e) {
        clientLog('wsManager', `Failed to parse message for tab ${tabId}: ${e}`, 'error');
      }
    });

    ws.addEventListener('error', (error) => {
      clientLog('wsManager', `WebSocket error for tab ${tabId}: ${error}`, 'error');
    });

    ws.addEventListener('close', (event) => {
      clientLog('wsManager', `Connection closed for tab ${tabId}, code: ${event.code}`);
      session.isConnected = false;

      // Mark session as stale for all closes - this ensures getOrCreateSession
      // will create a new connection for the next send operation.
      // This prevents issues with trying to reuse a closed WebSocket connection.
      session.isStale = true;
      clientLog('wsManager', `Session marked stale for tab ${tabId}`);

      // Attempt reconnect for unexpected closes only (don't reconnect for normal closes)
      if (event.code !== 1000 && event.code !== 1001) {
        clientLog('wsManager', `Unexpected close for tab ${tabId}, attempting reconnect`);
        this.attemptReconnect(tabId, sessionId);
      } else {
        clientLog('wsManager', `Normal close for tab ${tabId}, session marked stale for reuse`);
      }
    });

    return session;
  }

  private attemptReconnect(tabId: string, sessionId?: string) {
    const reconnectAttempts = globalState.reconnectAttempts;
    const sessions = globalState.sessions;
    const attempts = (reconnectAttempts.get(tabId) || 0) + 1;

    if (attempts > this.MAX_RECONNECT_ATTEMPTS) {
      clientLog('wsManager', `Max reconnect attempts reached for tab ${tabId}`, 'warn');
      return;
    }

    reconnectAttempts.set(tabId, attempts);
    clientLog('wsManager', `Reconnecting tab ${tabId}, attempt ${attempts}`);

    setTimeout(() => {
      const session = this.createSession(tabId, sessionId);
      sessions.set(tabId, session);
    }, this.RECONNECT_DELAY * attempts);
  }

  /**
   * Register a message handler for a specific tab
   */
  registerHandler(tabId: string, handler: MessageHandler): () => void {
    clientLog('wsManager', `registerHandler called for tab: ${tabId}`);
    const session = this.getOrCreateSession(tabId);
    clientLog('wsManager', `Current handlers count for tab ${tabId}: ${session.handlers.size}`);
    session.handlers.add(handler);
    clientLog('wsManager', `Handler registered, total handlers: ${session.handlers.size}`);

    // Return unregister function
    return () => {
      clientLog('wsManager', `Unregistering handler for tab: ${tabId}`);
      session.handlers.delete(handler);
    };
  }

  /**
   * Send a message through a specific tab's connection
   */
  send(tabId: string, message: any): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use getOrCreateSession to handle stale connections properly
      const session = this.getOrCreateSession(tabId);

      if (session.ws.readyState !== WebSocket.OPEN) {
        // Wait for connection
        const checkOpen = () => {
          if (session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify(message));
            resolve();
          } else if (session.ws.readyState === WebSocket.CONNECTING) {
            setTimeout(checkOpen, 50);
          } else {
            // Connection failed - getOrCreateSession will create new one next time
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
    const session = globalState.sessions.get(tabId);
    if (session) {
      session.ws.close(1000, 'Tab closed');
      session.handlers.clear();
      globalState.sessions.delete(tabId);
      console.log(`[WS Manager] Closed session for tab ${tabId}`);
    }
  }

  /**
   * Close all connections
   */
  closeAll() {
    globalState.sessions.forEach((session) => {
      session.ws.close(1000, 'All sessions closed');
    });
    globalState.sessions.clear();
    console.log('[WS Manager] Closed all sessions');
  }

  /**
   * Get session status
   */
  getSessionStatus(tabId: string): string {
    const session = globalState.sessions.get(tabId);
    if (!session) return 'none';
    if (session.isStale) return 'stale';
    if (session.isConnected) return 'connected';
    if (session.ws.readyState === WebSocket.CONNECTING) return 'connecting';
    return 'disconnected';
  }
}

// Singleton instance
export const wsManager = new WebSocketSessionManager();
