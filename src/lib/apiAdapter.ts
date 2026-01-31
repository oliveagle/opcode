/**
 * API Adapter - Compatibility layer for Tauri vs Web environments
 *
 * This module detects whether we're running in Tauri (desktop app) or web browser
 * and provides a unified interface that switches between:
 * - Tauri invoke calls (for desktop)
 * - REST API calls (for web/phone browser)
 */

import { invoke } from "@tauri-apps/api/core";

// Extend Window interface for Tauri
declare global {
  interface Window {
    __TAURI__?: any;
    __TAURI_METADATA__?: any;
    __TAURI_INTERNALS__?: any;
  }
}

// Client-side logger that sends logs to backend for debugging
const clientLogCache: Array<{ level: string; message: string; source: string; timestamp: string }> = [];
const LOG_CACHE_SIZE = 50;
let logEndpointChecked = false;

async function sendLogToBackend(level: string, source: string, message: string) {
  if (logEndpointChecked) {
    // Endpoint already checked and not available, skip
    return;
  }

  try {
    const response = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        source,
        message: message.substring(0, 2000), // Limit message size
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      logEndpointChecked = true; // Endpoint doesn't exist
    }
  } catch (e) {
    logEndpointChecked = true; // Network error, endpoint not available
  }
}

// Override console.log to capture frontend logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args: any[]) {
  originalConsoleLog.apply(console, args);
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  clientLogCache.push({ level: 'debug', message, source: 'console', timestamp: new Date().toISOString() });
  if (clientLogCache.length > LOG_CACHE_SIZE) clientLogCache.shift();
  sendLogToBackend('debug', 'console', message);
};

console.error = function(...args: any[]) {
  originalConsoleError.apply(console, args);
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  clientLogCache.push({ level: 'error', message, source: 'console', timestamp: new Date().toISOString() });
  if (clientLogCache.length > LOG_CACHE_SIZE) clientLogCache.shift();
  sendLogToBackend('error', 'console', message);
};

// Helper to send debug logs with specific source to backend
export function clientLog(source: string, message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  clientLogCache.push({ level, message, source, timestamp: new Date().toISOString() });
  if (clientLogCache.length > LOG_CACHE_SIZE) clientLogCache.shift();
  sendLogToBackend(level, source, message);
}

// Environment detection - removed caching as we now check for real Tauri internals

/**
 * Detect if we're running in Tauri environment
 */
export function detectEnvironment(): boolean {
  // Check if we're in a browser environment first
  if (typeof window === 'undefined') {
    return false;
  }

  // Check for Tauri-specific indicators that indicate REAL Tauri app
  // We check for __TAURI_METADATA__ and __TAURI_INTERNALS__ which are only set in real Tauri apps
  // window.__TAURI__ can be set by our initializeWebMode() in web mode, so we don't rely on it
  const hasTauriInternals = !!(window.__TAURI_METADATA__ || window.__TAURI_INTERNALS__);
  const hasTauriUA = navigator.userAgent.includes('Tauri') && !navigator.userAgent.includes('Mobile Safari');

  // Only detect Tauri if we have real Tauri internals or proper Tauri user agent
  const isTauri = hasTauriInternals || hasTauriUA;

  console.log('[detectEnvironment] hasTauriInternals:', hasTauriInternals);
  console.log('[detectEnvironment] hasTauriUA:', hasTauriUA);
  console.log('[detectEnvironment] userAgent:', navigator.userAgent);
  console.log('[detectEnvironment] isTauri:', isTauri);

  return isTauri;
}

/**
 * Network connection status types
 */
export type NetworkStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Network status callback type
 */
export type NetworkStatusCallback = (status: NetworkStatus) => void;

/**
 * Network status manager for tracking WebSocket connection state
 */
class NetworkStatusManager {
  private currentStatus: NetworkStatus = 'disconnected';
  private listeners: Set<NetworkStatusCallback> = new Set();
  private statusHistory: Array<{ status: NetworkStatus; timestamp: number }> = [];
  private maxHistoryLength = 50;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly HEALTH_CHECK_INTERVAL_MS = 3000; // Check every 3 seconds

  /**
   * Get current network status
   */
  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  /**
   * Get status history for debugging
   */
  getHistory(): Array<{ status: NetworkStatus; timestamp: number }> {
    return [...this.statusHistory];
  }

  /**
   * Update network status and notify listeners
   */
  setStatus(status: NetworkStatus): void {
    if (this.currentStatus === status) return;

    this.currentStatus = status;
    this.addToHistory(status);

    // Notify all listeners
    this.listeners.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('[NetworkStatusManager] Listener error:', error);
      }
    });

    console.log(`[NetworkStatusManager] Status changed to: ${status}`);
  }

  /**
   * Add status change to history
   */
  private addToHistory(status: NetworkStatus): void {
    this.statusHistory.push({ status, timestamp: Date.now() });

    // Keep history at max length
    if (this.statusHistory.length > this.maxHistoryLength) {
      this.statusHistory = this.statusHistory.slice(-this.maxHistoryLength);
    }
  }

  /**
   * Subscribe to network status changes
   */
  subscribe(callback: NetworkStatusCallback): () => void {
    this.listeners.add(callback);

    // Immediately call with current status
    callback(this.currentStatus);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Check if currently in a working state
   */
  isWorking(): boolean {
    return this.currentStatus === 'connecting' || this.currentStatus === 'connected';
  }

  /**
   * Check if there's an error state
   */
  hasError(): boolean {
    return this.currentStatus === 'error' || this.currentStatus === 'disconnected';
  }

  /**
   * Reset status to disconnected
   */
  reset(): void {
    this.setStatus('disconnected');
  }

  /**
   * Start periodic health checks to detect server availability
   * This enables automatic status detection when server comes online
   */
  startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return; // Already running
    }

    const performHealthCheck = async () => {
      try {
        const response = await fetch('/api/health', {
          method: 'GET',
          cache: 'no-store'
        });

        if (response.ok) {
          // Server is available
          if (this.currentStatus === 'disconnected' || this.currentStatus === 'error') {
            this.setStatus('connected');
          }
        } else {
          // Server returned an error but is responding
          if (this.currentStatus === 'disconnected') {
            this.setStatus('error');
          }
        }
      } catch (error) {
        // Network error - server is not available
        if (this.currentStatus === 'connected' || this.currentStatus === 'connecting') {
          this.setStatus('disconnected');
        }
      }
    };

    // Perform initial health check
    performHealthCheck();

    // Start periodic checks
    this.healthCheckInterval = setInterval(performHealthCheck, this.HEALTH_CHECK_INTERVAL_MS);

    console.log('[NetworkStatusManager] Health check started');
  }

  /**
   * Stop periodic health checks
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[NetworkStatusManager] Health check stopped');
    }
  }

  /**
   * Get health check status
   */
  isHealthCheckRunning(): boolean {
    return this.healthCheckInterval !== null;
  }
}

// Singleton instance
export const networkStatusManager = new NetworkStatusManager();

/**
 * Response wrapper for REST API calls
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Make a REST API call to our web server
 */
async function restApiCall<T>(endpoint: string, params?: any, method: string = 'GET'): Promise<T> {
  // First handle path parameters in the endpoint string
  let processedEndpoint = endpoint;
  console.log(`[REST API] Original endpoint: ${endpoint}, params:`, params, 'method:', method);
  
  if (params) {
    Object.keys(params).forEach(key => {
      // Try different case variations for the placeholder
      const placeholders = [
        `{${key}}`,
        `{${key.charAt(0).toLowerCase() + key.slice(1)}}`,
        `{${key.charAt(0).toUpperCase() + key.slice(1)}}`
      ];
      
      placeholders.forEach(placeholder => {
        if (processedEndpoint.includes(placeholder)) {
          console.log(`[REST API] Replacing ${placeholder} with ${params[key]}`);
          processedEndpoint = processedEndpoint.replace(placeholder, encodeURIComponent(String(params[key])));
        }
      });
    });
  }
  
  console.log(`[REST API] Processed endpoint: ${processedEndpoint}`);
  
  const url = new URL(processedEndpoint, window.location.origin);
  
  // Add remaining params as query parameters for GET requests (if no placeholders remain)
  if (params && !processedEndpoint.includes('{') && method === 'GET') {
    Object.keys(params).forEach(key => {
      // Only add as query param if it wasn't used as a path param
      if (!endpoint.includes(`{${key}}`) && 
          !endpoint.includes(`{${key.charAt(0).toLowerCase() + key.slice(1)}}`) &&
          !endpoint.includes(`{${key.charAt(0).toUpperCase() + key.slice(1)}}`) &&
          params[key] !== undefined && 
          params[key] !== null) {
        url.searchParams.append(key, String(params[key]));
      }
    });
  }

  try {
    const fetchOptions: RequestInit = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Add body for POST/PUT requests
    if ((method === 'POST' || method === 'PUT') && params && !processedEndpoint.includes('{')) {
      const bodyParams = { ...params };
      // Remove path params from body
      Object.keys(bodyParams).forEach(key => {
        if (endpoint.includes(`{${key}}`) || 
            endpoint.includes(`{${key.charAt(0).toLowerCase() + key.slice(1)}}`) ||
            endpoint.includes(`{${key.charAt(0).toUpperCase() + key.slice(1)}}`)) {
          delete bodyParams[key];
        }
      });
      if (Object.keys(bodyParams).length > 0) {
        fetchOptions.body = JSON.stringify(bodyParams);
      }
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: ApiResponse<T> = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'API call failed');
    }

    return result.data as T;
  } catch (error) {
    console.error(`REST API call failed for ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Browse server directory contents
 */
export async function browseServerDirectory(path: string = '/'): Promise<{ path: string; items: DirItem[] }> {
  const params = new URLSearchParams({ path });
  const response = await fetch(`/api/browse?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Failed to browse directory');
  }
  return result.data;
}

/**
 * Get directory tree for navigation
 */
export async function getServerDirectoryTree(path: string = '/'): Promise<DirItem> {
  const params = new URLSearchParams({ path });
  const response = await fetch(`/api/browse/tree?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Failed to get directory tree');
  }
  return result.data;
}

/**
 * Validate project path
 */
export async function validateProjectPath(path: string): Promise<{ valid: boolean; path: string }> {
  const params = new URLSearchParams({ path });
  const response = await fetch(`/api/validate-path?${params}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Failed to validate path');
  }
  return result.data;
}

/**
 * Directory item type
 */
export interface DirItem {
  name: string;
  path: string;
  isDir: boolean;
  children?: DirItem[];
}

/**
 * Web mode folder picker using server-side directory browser
 */
export async function selectDirectoryWeb(): Promise<string | null> {
  // This function is deprecated - use browseServerDirectory with UI instead
  // For now, fall back to home directory
  try {
    const home = await apiCall<string>('get_home_directory');
    return home;
  } catch {
    return '/home';
  }
}

/**
 * Get environment info for debugging
 */
export function getEnvironmentInfo() {
  return {
    isTauri: detectEnvironment(),
    userAgent: navigator.userAgent,
    location: window.location.href,
  };
}

/**
 * Session persistence utilities for WebSocket connections
 */
const SESSION_STORAGE_KEY = 'opcode_ws_session_id';

function getPersistentSessionId(): string {
  if (typeof sessionStorage === 'undefined') {
    console.log('[WS Session] sessionStorage not available, generating temp session');
    return `session-${Date.now()}`;
  }
  
  let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    console.log(`[WS Session] Created NEW session: ${sessionId}`);
  } else {
    console.log(`[WS Session] Reused EXISTING session: ${sessionId}`);
  }
  return sessionId;
}

/**
 * Handle streaming commands via WebSocket in web mode
 * Uses WebSocketSessionManager for per-tab isolation
 */
async function handleStreamingCommand<T>(command: string, params?: any): Promise<T> {
  clientLog('apiAdapter', `handleStreamingCommand ENTERED - command: ${command}`);
  clientLog('apiAdapter', `params: ${JSON.stringify(params || {})}`);

  const tabId = params?.tabId || 'default';
  // Use persistent session ID across page reloads
  const sessionId = params?.sessionId || getPersistentSessionId();

  clientLog('apiAdapter', `tabId: "${tabId}", sessionId: "${sessionId}"`);

  // Update network status to connecting
  networkStatusManager.setStatus('connecting');

  return new Promise(async (resolve, reject) => {
    // Dynamic import for browser compatibility
    const { wsManager } = await import('./wsSessionManager');

    clientLog('apiAdapter', `Calling getOrCreateSession with tabId: "${tabId}", sessionId: "${sessionId}"`);
    const session = wsManager.getOrCreateSession(tabId, sessionId);
    clientLog('apiAdapter', `Session created/retrieved - id: ${session.id}, ws.readyState: ${session.ws.readyState}, isStale: ${session.isStale}`);

    // Track if we've already resolved/rejected to avoid multiple callbacks
    let isResolved = false;

    // Track if message was successfully sent to clear timeout
    // MUST be declared before sendTimeout to avoid hoisting issues
    let messageSuccessfullySent = false;

    // Add timeout protection - reject if we can't send within 5 seconds (longer for mobile)
    const sendTimeout = setTimeout(() => {
      if (!isResolved) {
        // CRITICAL FIX: If message was already sent, don't timeout - we're waiting for response now
        if (messageSuccessfullySent) {
          clientLog('apiAdapter', 'Timeout reached but message was already sent, ignoring timeout');
          return;
        }
        clientLog('apiAdapter', `Send timeout reached - readyState: ${session.ws.readyState}, isStale: ${session.isStale}, messageSent: ${messageSuccessfullySent}`, 'error');
        if (!isResolved) {
          isResolved = true;
          networkStatusManager.setStatus('error');
          unregister();
          reject(new Error(`WebSocket connection timeout (state=${session.ws.readyState}) - failed to establish connection within 5 seconds`));
        }
      }
    }, 5000);

    const safeResolve = (value: T) => {
      clearTimeout(sendTimeout);
      clientLog('apiAdapter', 'safeResolve called');
      if (isResolved) return;
      isResolved = true;
      networkStatusManager.setStatus('connected');
      resolve(value);
    };

    const safeReject = (error: Error) => {
      clearTimeout(sendTimeout);
      clientLog('apiAdapter', `safeReject called: ${error.message}`, 'error');
      if (isResolved) return;
      isResolved = true;
      networkStatusManager.setStatus('error');
      reject(error);
    };

    // Register handler FIRST - before sending - to avoid missing messages
    // that might arrive before handler registration completes
    const unregister = wsManager.registerHandler(tabId, (message: any) => {
      clientLog('apiAdapter', `Received message for tab ${tabId}: ${JSON.stringify(message).substring(0, 200)}`);

      // Update status to connected when we receive output
      networkStatusManager.setStatus('connected');

      if (message.type === 'output') {
        try {
          const claudeMessage = typeof message.content === 'string'
            ? JSON.parse(message.content)
            : message.content;
          const customEvent = new CustomEvent('claude-output', {
            detail: claudeMessage
          });
          window.dispatchEvent(customEvent);
        } catch (e) {
          clientLog('apiAdapter', `Failed to parse Claude output: ${e}`, 'error');
        }
      } else if (message.type === 'completion') {
        const completeEvent = new CustomEvent('claude-complete', {
          detail: message.status === 'success'
        });
        window.dispatchEvent(completeEvent);
        unregister();
        if (message.status === 'success') {
          safeResolve({} as T);
        } else {
          safeReject(new Error(message.error || 'Execution failed'));
        }
      } else if (message.type === 'error') {
        const errorEvent = new CustomEvent('claude-error', {
          detail: message.message || 'Unknown error'
        });
        window.dispatchEvent(errorEvent);
        unregister();
        safeReject(new Error(message.message || 'Unknown error'));
      }
    });

    // Send request when connection is ready
    // Use a flag to track if the message has been sent
    let messageSent = false;

    const checkAndSend = () => {
      clientLog('apiAdapter', `checkAndSend - messageSent: ${messageSent}, readyState: ${session.ws.readyState}`);

      // Prevent sending multiple messages
      if (messageSent) {
        clientLog('apiAdapter', 'checkAndSend - ALREADY SENT, skipping');
        return;
      }

      if (session.ws.readyState === WebSocket.OPEN) {
        messageSent = true;
        // Generate UUID for idempotency (with fallback for browsers without crypto.randomUUID)
        const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `uuid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const request = {
          uuid: uuid,
          command_type: command.replace('_claude_code', ''),
          project_path: params?.projectPath || '',
          prompt: params?.prompt || '',
          model: params?.model || 'claude-3-5-sonnet-20241022',
          session_id: sessionId,
          images: params?.images || [],
        };
        clientLog('apiAdapter', `Sending WebSocket request - uuid: ${uuid}, command_type: ${request.command_type}`);
        session.ws.send(JSON.stringify(request));
        clientLog('apiAdapter', 'WebSocket send() called successfully');
        // CRITICAL: Clear the timeout once message is sent - the connection is now established
        // and we're waiting for the response, not for the connection to open
        if (!messageSuccessfullySent) {
          messageSuccessfullySent = true;
          clearTimeout(sendTimeout);
          clientLog('apiAdapter', 'sendTimeout cleared - message successfully sent');
        }
      } else if (session.ws.readyState === WebSocket.CONNECTING) {
        // Still connecting - schedule retry with timeout protection
        clientLog('apiAdapter', 'WebSocket CONNECTING, scheduling retry in 50ms...');
        setTimeout(checkAndSend, 50);
      } else {
        clientLog('apiAdapter', `WebSocket state: ${session.ws.readyState} (not OPEN or CONNECTING)`, 'error');
        unregister();
        safeReject(new Error('WebSocket connection failed - state: ' + session.ws.readyState));
      }
    };

    // Handle connection opened - use addEventListener so wsManager's handler also runs
    session.ws.addEventListener('open', () => {
      clientLog('apiAdapter', 'onopen FIRED - calling checkAndSend');
      networkStatusManager.setStatus('connected');
      checkAndSend();
    });

    session.ws.addEventListener('error', (error: Event) => {
      clientLog('apiAdapter', `onerror FIRED: ${error}`, 'error');
      networkStatusManager.setStatus('error');
      // Only reject if we haven't resolved yet
      if (!isResolved) {
        unregister();
        const errorEvent = new CustomEvent('claude-error', {
          detail: 'WebSocket connection failed'
        });
        window.dispatchEvent(errorEvent);
        safeReject(new Error('WebSocket connection failed'));
      }
    });

    session.ws.addEventListener('close', (event: CloseEvent) => {
      clientLog('apiAdapter', `WebSocket connection closed: code=${event.code}, reason=${event.reason}`);
      if (event.code !== 1000 && event.code !== 1001) {
        // Unexpected close - could indicate network issues
        networkStatusManager.setStatus('error');
        const cancelEvent = new CustomEvent('claude-complete', {
          detail: false
        });
        window.dispatchEvent(cancelEvent);
      } else {
        // Normal close
        networkStatusManager.setStatus('disconnected');
      }
    });

    checkAndSend();
  });
}

/**
 * Unified API adapter that works in both Tauri and web environments
 */
export async function apiCall<T>(command: string, params?: any): Promise<T> {
  clientLog('apiAdapter', `apiCall ENTERED - command: ${command}`);
  clientLog('apiAdapter', `apiCall params: ${JSON.stringify(params || {})}`);

  const isWeb = !detectEnvironment();
  clientLog('apiAdapter', `isWeb: ${isWeb}`);

  if (!isWeb) {
    console.log(`[Tauri] Calling: ${command}`, params);
    try {
      return await invoke<T>(command, params);
    } catch (error) {
      console.warn(`[Tauri] invoke failed, falling back to web mode:`, error);
    }
  }
  
  console.log(`[Web] Calling: ${command}`, params);
  
  // Special handling for streaming commands
  const streamingCommands = ['execute_claude_code', 'continue_claude_code', 'resume_claude_code'];
  if (streamingCommands.includes(command)) {
    return handleStreamingCommand<T>(command, params);
  }
  
  // Determine HTTP method based on command
  let method = 'GET';
  if (command.startsWith('create_') || command.startsWith('add_') || command === 'import_agent' || command === 'import_agent_from_github' || command === 'import_agent_from_file') {
    method = 'POST';
  } else if (command.startsWith('update_') || command.startsWith('save_') || command.startsWith('set_')) {
    method = 'PUT';
  } else if (command.startsWith('delete_') || command.startsWith('remove_') || command.startsWith('kill_')) {
    method = 'DELETE';
  }
  
  // Map Tauri commands to REST endpoints
  const endpoint = mapCommandToEndpoint(command, params);
  return await restApiCall<T>(endpoint, params, method);
}

/**
 * Map Tauri command names to REST API endpoints
 */
function mapCommandToEndpoint(command: string, _params?: any): string {
  const commandToEndpoint: Record<string, string> = {
    'get_home_directory': '/api/home',
    'browse_directory': '/api/browse',
    'get_directory_tree': '/api/browse/tree',
    'validate_project_path': '/api/validate-path',
    'create_project': '/api/projects',
    'list_projects': '/api/projects',
    'get_project_sessions': '/api/projects/{projectId}/sessions',
    
    // Agent commands
    'list_agents': '/api/agents',
    'fetch_github_agents': '/api/agents/github',
    'fetch_github_agent_content': '/api/agents/github/content',
    'import_agent_from_github': '/api/agents/import/github',
    'create_agent': '/api/agents',
    'update_agent': '/api/agents/{id}',
    'delete_agent': '/api/agents/{id}',
    'get_agent': '/api/agents/{id}',
    'export_agent': '/api/agents/{id}/export',
    'import_agent': '/api/agents/import',
    'import_agent_from_file': '/api/agents/import/file',
    'execute_agent': '/api/agents/{agentId}/execute',
    'list_agent_runs': '/api/agents/runs',
    'list_agent_runs_with_metrics': '/api/agents/runs/metrics',
    'get_agent_run': '/api/agents/runs/{id}',
    'get_agent_run_with_real_time_metrics': '/api/agents/runs/{id}/metrics',
    'list_running_sessions': '/api/sessions/running',
    'kill_agent_session': '/api/agents/sessions/{runId}/kill',
    'get_session_status': '/api/agents/sessions/{runId}/status',
    'cleanup_finished_processes': '/api/agents/sessions/cleanup',
    'get_session_output': '/api/agents/sessions/{runId}/output',
    'get_live_session_output': '/api/agents/sessions/{runId}/output/live',
    'stream_session_output': '/api/agents/sessions/{runId}/output/stream',
    'load_agent_session_history': '/api/agents/sessions/{sessionId}/history',
    
    // Usage commands
    'get_usage_stats': '/api/usage',
    'get_usage_by_date_range': '/api/usage/range',
    'get_session_stats': '/api/usage/sessions',
    'get_usage_details': '/api/usage/details',
    
    // Settings and configuration
    'get_claude_settings': '/api/settings/claude',
    'save_claude_settings': '/api/settings/claude',
    'get_system_prompt': '/api/settings/system-prompt',
    'save_system_prompt': '/api/settings/system-prompt',
    'check_claude_version': '/api/settings/claude/version',
    'find_claude_md_files': '/api/claude-md',
    'read_claude_md_file': '/api/claude-md/read',
    'save_claude_md_file': '/api/claude-md/save',
    
    // Session management
    'open_new_session': '/api/sessions/new',
    'load_session_history': '/api/sessions/{sessionId}/history/{projectId}',
    'list_running_claude_sessions': '/api/sessions/running',
    'execute_claude_code': '/api/sessions/execute',
    'continue_claude_code': '/api/sessions/continue',
    'resume_claude_code': '/api/sessions/resume',
    'cancel_claude_execution': '/api/sessions/{sessionId}/cancel',
    'get_claude_session_output': '/api/sessions/{sessionId}/output',
    
    // MCP commands
    'mcp_add': '/api/mcp/servers',
    'mcp_list': '/api/mcp/servers',
    'mcp_get': '/api/mcp/servers/{name}',
    'mcp_remove': '/api/mcp/servers/{name}',
    'mcp_add_json': '/api/mcp/servers/json',
    'mcp_add_from_claude_desktop': '/api/mcp/import/claude-desktop',
    'mcp_serve': '/api/mcp/serve',
    'mcp_test_connection': '/api/mcp/servers/{name}/test',
    'mcp_reset_project_choices': '/api/mcp/reset-choices',
    'mcp_get_server_status': '/api/mcp/status',
    'mcp_read_project_config': '/api/mcp/project-config',
    'mcp_save_project_config': '/api/mcp/project-config',
    
    // Binary and installation management
    'get_claude_binary_path': '/api/settings/claude/binary-path',
    'set_claude_binary_path': '/api/settings/claude/binary-path',
    'list_claude_installations': '/api/settings/claude/installations',
    
    // Storage commands
    'storage_list_tables': '/api/storage/tables',
    'storage_read_table': '/api/storage/tables/{tableName}',
    'storage_update_row': '/api/storage/tables/{tableName}/rows',
    'storage_delete_row': '/api/storage/tables/{tableName}/rows',
    'storage_insert_row': '/api/storage/tables/{tableName}/rows',
    'storage_execute_sql': '/api/storage/sql',
    'storage_reset_database': '/api/storage/reset',
    
    // Hooks configuration
    'get_hooks_config': '/api/hooks/config',
    'update_hooks_config': '/api/hooks/config',
    'validate_hook_command': '/api/hooks/validate',
    
    // Slash commands
    'slash_commands_list': '/api/slash-commands',
    'slash_command_get': '/api/slash-commands/{commandId}',
    'slash_command_save': '/api/slash-commands',
    'slash_command_delete': '/api/slash-commands/{commandId}',

    // Process monitor commands
    'get_all_processes': '/api/processes',
    'get_process_stats': '/api/processes/stats',
    'kill_process_by_run_id': '/api/processes/{runId}/kill',
    'kill_all_processes': '/api/processes/kill/all',
    'kill_all_claude_sessions': '/api/processes/kill/claude-sessions',
    'kill_all_agent_runs': '/api/processes/kill/agent-runs',
  };

  const endpoint = commandToEndpoint[command];
  if (!endpoint) {
    console.warn(`Unknown command: ${command}, falling back to generic endpoint`);
    return `/api/unknown/${command}`;
  }

  return endpoint;
}

/**
 * Initialize web mode compatibility
 * Sets up mocks for Tauri APIs when running in web mode
 */
export function initializeWebMode() {
  if (!detectEnvironment()) {
    if (!window.__TAURI__) {
      window.__TAURI__ = {
        event: {
          listen: (eventName: string, callback: (event: any) => void) => {
            const handler = (e: any) => callback({ payload: e.detail });
            window.addEventListener(`${eventName}`, handler);
            return Promise.resolve(() => {
              window.removeEventListener(`${eventName}`, handler);
            });
          },
          emit: () => Promise.resolve(),
        },
        invoke: () => Promise.reject(new Error('Tauri invoke not available in web mode')),
        core: {
          invoke: () => Promise.reject(new Error('Tauri invoke not available in web mode')),
          transformCallback: () => {
            throw new Error('Tauri transformCallback not available in web mode');
          }
        }
      };
    }
  }
}
