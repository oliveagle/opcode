// Web server types module
// Contains shared types used across web handlers

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Information about an active WebSocket session
#[derive(Clone)]
pub struct SessionInfo {
    pub sender: tokio::sync::mpsc::Sender<String>,
    pub created_at: std::time::Instant,
}

/// Application state shared across all routes
#[derive(Clone)]
pub struct AppState {
    /// Track active WebSocket sessions for Claude execution
    pub active_sessions: Arc<Mutex<std::collections::HashMap<String, SessionInfo>>>,
    /// Database path for on-demand connections
    pub db_path: PathBuf,
    /// Process registry for monitoring
    pub process_registry: Arc<crate::process::registry::ProcessRegistry>,
}
