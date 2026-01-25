use axum::extract::ws::{Message, WebSocket};
use axum::http::Method;
use axum::{
    extract::{Path, Query, State as AxumState, WebSocketUpgrade},
    response::{Html, Json, Response},
    routing::{delete, get, post, MethodRouter},
    Router,
};
use chrono;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use which;

// Import storage types
use crate::commands::storage::{TableData, TableInfo};

use crate::commands;

// Find Claude binary for web mode - use bundled binary first
fn find_claude_binary_web() -> Result<String, String> {
    // First try the bundled binary (same location as Tauri app uses)
    let bundled_binary = "src-tauri/binaries/claude-code-x86_64-unknown-linux-gnu";
    if std::path::Path::new(bundled_binary).exists() {
        println!(
            "[find_claude_binary_web] Using bundled binary: {}",
            bundled_binary
        );
        return Ok(bundled_binary.to_string());
    }

    // Fall back to system installation paths
    let home_path = format!(
        "{}/.local/bin/claude",
        std::env::var("HOME").unwrap_or_default()
    );
    let candidates = vec![
        "claude",
        "claude-code",
        "/usr/local/bin/claude",
        "/usr/bin/claude",
        "/opt/homebrew/bin/claude",
        &home_path,
    ];

    for candidate in candidates {
        if which::which(candidate).is_ok() {
            println!(
                "[find_claude_binary_web] Using system binary: {}",
                candidate
            );
            return Ok(candidate.to_string());
        }
    }

    Err("Claude binary not found in bundled location or system paths".to_string())
}

#[derive(Clone)]
pub struct AppState {
    // Track active WebSocket sessions for Claude execution
    pub active_sessions:
        Arc<tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::mpsc::Sender<String>>>>,
    // Database path for on-demand connections
    pub db_path: std::path::PathBuf,
    // Process registry for monitoring
    pub process_registry: Arc<crate::process::registry::ProcessRegistry>,
}

/// Get a new database connection from the path
fn get_db_connection(path: &std::path::PathBuf) -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(path)
        .map_err(|e| format!("Failed to open database: {}", e))
}

#[derive(Debug, Deserialize)]
pub struct ClaudeExecutionRequest {
    pub project_path: String,
    pub prompt: String,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub command_type: String, // "execute", "continue", or "resume"
}

#[derive(Deserialize)]
pub struct QueryParams {
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

/// Serve the React frontend
async fn serve_frontend() -> Html<&'static str> {
    Html(include_str!("../../dist/index.html"))
}

/// Initialize SQLite database for web mode
fn init_web_db() -> Result<std::path::PathBuf, String> {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("opcode");

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    let db_path = data_dir.join("web.db");
    
    // Initialize the database with tables
    {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable foreign keys
        conn.execute("PRAGMA foreign_keys = ON", [])
            .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

        // Create agents table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                system_prompt TEXT NOT NULL,
                icon TEXT,
                model TEXT DEFAULT 'sonnet',
                max_tokens INTEGER DEFAULT 8192,
                temperature REAL DEFAULT 0.0,
                read_enabled INTEGER DEFAULT 1,
                write_enabled INTEGER DEFAULT 1,
                network_enabled INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )",
            [],
        ).map_err(|e| format!("Failed to create agents table: {}", e))?;

        // Create agent_runs table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id INTEGER NOT NULL,
                project_path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                prompt TEXT,
                output TEXT,
                error TEXT,
                model TEXT,
                tokens_used INTEGER DEFAULT 0,
                cost REAL DEFAULT 0.0,
                started_at INTEGER DEFAULT (strftime('%s', 'now')),
                completed_at INTEGER,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            )",
            [],
        ).map_err(|e| format!("Failed to create agent_runs table: {}", e))?;

        // Create app_settings table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        ).map_err(|e| format!("Failed to create app_settings table: {}", e))?;
    }

    println!("[init_web_db] Database initialized at: {:?}", db_path);
    Ok(db_path)
}

/// Storage API endpoints for web mode

/// List all tables in the database
async fn storage_list_tables(AxumState(state): AxumState<AppState>) -> impl axum::response::IntoResponse {
    let result = list_tables_impl(&state.db_path);
    
    match result {
        Ok(tables) => Json(ApiResponse::success(tables)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// List tables using fresh connection
fn list_tables_impl(db_path: &std::path::PathBuf) -> Result<Vec<TableInfo>, String> {
    let conn = get_db_connection(db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).map_err(|e| e.to_string())?;

    let table_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for table_name in table_names {
        let count_conn = get_db_connection(db_path).map_err(|e| e.to_string())?;
        let row_count: i64 = count_conn
            .query_row(&format!("SELECT COUNT(*) FROM {}", table_name), [], |row| row.get(0))
            .unwrap_or(0);

        let pragma_conn = get_db_connection(db_path).map_err(|e| e.to_string())?;
        let mut pragma_stmt = pragma_conn.prepare(&format!("PRAGMA table_info({})", table_name)).map_err(|e| e.to_string())?;
        let columns: Vec<crate::commands::storage::ColumnInfo> = pragma_stmt
            .query_map([], |row| {
                Ok(crate::commands::storage::ColumnInfo {
                    cid: row.get(0)?,
                    name: row.get(1)?,
                    type_name: row.get(2)?,
                    notnull: row.get::<_, i32>(3)? != 0,
                    dflt_value: row.get(4)?,
                    pk: row.get::<_, i32>(5)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        tables.push(TableInfo {
            name: table_name,
            row_count,
            columns,
        });
    }

    Ok(tables)
}

/// Read table data with pagination
#[derive(Deserialize)]
struct ReadTableQuery {
    page: Option<i64>,
    #[serde(rename = "pageSize")]
    page_size: Option<i64>,
    #[serde(rename = "searchQuery")]
    search_query: Option<String>,
}

async fn storage_read_table(
    Path(table_name): Path<String>,
    Query(query): Query<ReadTableQuery>,
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(50);
    let search_query = query.search_query;

    match read_table_impl(&state.db_path, &table_name, page, page_size, search_query) {
        Ok(data) => Json(ApiResponse::success(data)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

fn read_table_impl(
    db_path: &std::path::PathBuf,
    table_name: &str,
    page: i64,
    page_size: i64,
    search_query: Option<String>,
) -> Result<TableData, String> {
    // Get column information
    let pragma_conn = get_db_connection(db_path).map_err(|e| e.to_string())?;
    let mut pragma_stmt = pragma_conn.prepare(&format!("PRAGMA table_info({})", table_name)).map_err(|e| e.to_string())?;
    let columns: Vec<crate::commands::storage::ColumnInfo> = pragma_stmt
        .query_map([], |row| {
            Ok(crate::commands::storage::ColumnInfo {
                cid: row.get(0)?,
                name: row.get(1)?,
                type_name: row.get(2)?,
                notnull: row.get::<_, i32>(3)? != 0,
                dflt_value: row.get(4)?,
                pk: row.get::<_, i32>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Build query with optional search
    let (query, count_query) = if let Some(search) = &search_query {
        let search_conditions: Vec<String> = columns
            .iter()
            .filter(|col| col.type_name.contains("TEXT") || col.type_name.contains("VARCHAR"))
            .map(|col| format!("{} LIKE '%{}%'", col.name, search.replace("'", "''")))
            .collect();

        if search_conditions.is_empty() {
            (
                format!("SELECT * FROM {} LIMIT ? OFFSET ?", table_name),
                format!("SELECT COUNT(*) FROM {}", table_name),
            )
        } else {
            let where_clause = search_conditions.join(" OR ");
            (
                format!("SELECT * FROM {} WHERE {} LIMIT ? OFFSET ?", table_name, where_clause),
                format!("SELECT COUNT(*) FROM {} WHERE {}", table_name, where_clause),
            )
        }
    } else {
        (
            format!("SELECT * FROM {} LIMIT ? OFFSET ?", table_name),
            format!("SELECT COUNT(*) FROM {}", table_name),
        )
    };

    let count_conn = get_db_connection(db_path).map_err(|e| e.to_string())?;
    let total_rows: i64 = count_conn.query_row(&count_query, [], |row| row.get(0)).unwrap_or(0);
    let offset = (page - 1) * page_size;
    let total_pages = (total_rows as f64 / page_size as f64).ceil() as i64;

    let data_conn = get_db_connection(db_path).map_err(|e| e.to_string())?;
    let mut data_stmt = data_conn.prepare(&query).map_err(|e| e.to_string())?;
    let rows: Vec<serde_json::Map<String, serde_json::Value>> = data_stmt
        .query_map(rusqlite::params![page_size, offset], |row| {
            let mut row_map = serde_json::Map::new();
            for (idx, col) in columns.iter().enumerate() {
                let value = match row.get_ref(idx)? {
                    rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(i) => serde_json::Value::Number(serde_json::Number::from(i)),
                    rusqlite::types::ValueRef::Real(f) => {
                        if let Some(n) = serde_json::Number::from_f64(f) {
                            serde_json::Value::Number(n)
                        } else {
                            serde_json::Value::String(f.to_string())
                        }
                    }
                    rusqlite::types::ValueRef::Text(s) => serde_json::Value::String(String::from_utf8_lossy(s).to_string()),
                    rusqlite::types::ValueRef::Blob(b) => serde_json::Value::String(base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        b,
                    )),
                };
                row_map.insert(col.name.clone(), value);
            }
            Ok(row_map)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(TableData {
        table_name: table_name.to_string(),
        columns,
        rows,
        total_rows,
        page,
        page_size,
        total_pages,
    })
}

fn json_to_sql_value(value: &serde_json::Value) -> Box<dyn rusqlite::ToSql> {
    match value {
        serde_json::Value::Null => Box::new(rusqlite::types::Null),
        serde_json::Value::Bool(b) => Box::new(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Box::new(value.to_string())
        }
    }
}

/// Insert a new row into a table
#[derive(Deserialize, Clone)]
struct InsertRowRequest {
    values: std::collections::HashMap<String, serde_json::Value>,
}

/// Synchronous insert operation for storage API
fn insert_row_impl(
    conn: &rusqlite::Connection,
    table_name: &str,
    values: std::collections::HashMap<String, serde_json::Value>,
) -> Result<i64, String> {
    let columns: Vec<&String> = values.keys().collect();
    let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("?{}", i)).collect();
    let query = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table_name,
        columns.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", "),
        placeholders.join(", ")
    );

    let params: Vec<Box<dyn rusqlite::ToSql>> = values
        .values()
        .map(|v| json_to_sql_value(v))
        .collect();

    conn.execute(&query, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
        .map_err(|e| format!("Failed to insert row: {}", e))?;
    Ok(conn.last_insert_rowid())
}

async fn storage_insert_row(
    Path(table_name): Path<String>,
    AxumState(state): AxumState<AppState>,
    Json(req): Json<InsertRowRequest>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    match insert_row_impl(&conn, &table_name, req.values) {
        Ok(id) => Json(ApiResponse::success(id)),
        Err(e) => Json(ApiResponse::error(e)),
    }
}

/// Update a row in a table
#[derive(Deserialize)]
struct UpdateRowRequest {
    primary_key_values: std::collections::HashMap<String, serde_json::Value>,
    updates: std::collections::HashMap<String, serde_json::Value>,
}

/// Delete a row from a table
#[derive(Deserialize)]
struct DeleteRowRequest {
    primary_key_values: std::collections::HashMap<String, serde_json::Value>,
}


/// Synchronous update operation for storage API
fn update_row_impl(
    conn: &rusqlite::Connection,
    table_name: &str,
    primary_key_values: std::collections::HashMap<String, serde_json::Value>,
    updates: std::collections::HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let set_clauses: Vec<String> = updates
        .keys()
        .enumerate()
        .map(|(idx, key)| format!("{} = ?{}", key, idx + 1))
        .collect();

    let where_clauses: Vec<String> = primary_key_values
        .keys()
        .enumerate()
        .map(|(idx, key)| format!("{} = ?{}", key, idx + updates.len() + 1))
        .collect();

    let query = format!(
        "UPDATE {} SET {} WHERE {}",
        table_name,
        set_clauses.join(", "),
        where_clauses.join(" AND ")
    );

    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    for value in updates.values() {
        params.push(json_to_sql_value(value));
    }
    for value in primary_key_values.values() {
        params.push(json_to_sql_value(value));
    }

    conn.execute(&query, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
        .map_err(|e| format!("Failed to update row: {}", e))?;
    Ok(())
}

async fn storage_update_row(
    Path(table_name): Path<String>,
    AxumState(state): AxumState<AppState>,
    Json(req): Json<UpdateRowRequest>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    match update_row_impl(&conn, &table_name, req.primary_key_values, req.updates) {
        Ok(_) => Json(ApiResponse::success(())),
        Err(e) => Json(ApiResponse::error(e)),
    }
}

/// Synchronous delete operation for storage API
fn delete_row_impl(
    conn: &rusqlite::Connection,
    table_name: &str,
    primary_key_values: std::collections::HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let where_clauses: Vec<String> = primary_key_values
        .keys()
        .enumerate()
        .map(|(idx, key)| format!("{} = ?{}", key, idx + 1))
        .collect();

    let query = format!(
        "DELETE FROM {} WHERE {}",
        table_name,
        where_clauses.join(" AND ")
    );

    let params: Vec<Box<dyn rusqlite::ToSql>> = primary_key_values
        .values()
        .map(|v| json_to_sql_value(v))
        .collect();

    conn.execute(&query, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
        .map_err(|e| format!("Failed to delete row: {}", e))?;
    Ok(())
}

async fn storage_delete_row(
    Path(table_name): Path<String>,
    AxumState(state): AxumState<AppState>,
    Json(req): Json<DeleteRowRequest>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    match delete_row_impl(&conn, &table_name, req.primary_key_values) {
        Ok(_) => Json(ApiResponse::success(())),
        Err(e) => Json(ApiResponse::error(e)),
    }
}

/// Router for storage rows CRUD operations
fn storage_rows_router() -> MethodRouter<AppState> {
    MethodRouter::<AppState>::new()
        .post(storage_insert_row)
        .put(storage_update_row)
        .delete(storage_delete_row)
}

/// API endpoint to get projects (equivalent to Tauri command)
async fn get_projects() -> impl axum::response::IntoResponse {
    match commands::claude::list_projects().await {
        Ok(projects) => Json(ApiResponse::success(projects)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// API endpoint to create a new project (equivalent to Tauri command)
async fn create_project(
    Json(req): Json<serde_json::Value>,
) -> impl axum::response::IntoResponse {
    let path = req.get("path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing 'path' field".to_string());
    
    let path = match path {
        Ok(p) => p,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    match commands::claude::create_project(path).await {
        Ok(project) => Json(ApiResponse::success(project)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// API endpoint to get sessions for a project
async fn get_sessions(
    Path(project_id): Path<String>,
) -> Json<ApiResponse<Vec<commands::claude::Session>>> {
    match commands::claude::get_project_sessions(project_id).await {
        Ok(sessions) => Json(ApiResponse::success(sessions)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// Agent request/response types
#[derive(Deserialize, Serialize)]
#[allow(dead_code)]
struct AgentRow {
    id: Option<i64>,
    name: String,
    description: Option<String>,
    system_prompt: String,
    icon: Option<String>,
    model: String,
    max_tokens: i64,
    temperature: f64,
    read_enabled: i64,
    write_enabled: i64,
    network_enabled: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
struct CreateAgentRequest {
    name: String,
    description: Option<String>,
    system_prompt: String,
    icon: Option<String>,
    model: Option<String>,
    max_tokens: Option<i64>,
    temperature: Option<f64>,
}

#[derive(Deserialize)]
struct UpdateAgentRequest {
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    icon: Option<String>,
    model: Option<String>,
    max_tokens: Option<i64>,
    temperature: Option<f64>,
}

/// List all agents
async fn get_agents(AxumState(state): AxumState<AppState>) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, name, description, system_prompt, icon, model, max_tokens, temperature,
         read_enabled, write_enabled, network_enabled, created_at, updated_at
         FROM agents ORDER BY name"
    ) {
        Ok(s) => s,
        Err(e) => return Json(ApiResponse::error(format!("Failed to prepare query: {}", e))),
    };

    let agents: Vec<serde_json::Value> = match stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "name": row.get::<_, String>(1)?,
            "description": row.get::<_, Option<String>>(2)?,
            "system_prompt": row.get::<_, String>(3)?,
            "icon": row.get::<_, Option<String>>(4)?,
            "model": row.get::<_, String>(5)?,
            "max_tokens": row.get::<_, i64>(6)?,
            "temperature": row.get::<_, f64>(7)?,
            "read_enabled": row.get::<_, i64>(8)? != 0,
            "write_enabled": row.get::<_, i64>(9)? != 0,
            "network_enabled": row.get::<_, i64>(10)? != 0,
            "created_at": row.get::<_, i64>(11)?,
            "updated_at": row.get::<_, i64>(12)?,
        }))
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };

    Json(ApiResponse::success(agents))
}

/// Create a new agent
async fn create_agent(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<CreateAgentRequest>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    let model = req.model.unwrap_or_else(|| "sonnet".to_string());
    let max_tokens = req.max_tokens.unwrap_or(8192);
    let temperature = req.temperature.unwrap_or(0.0);

    match conn.execute(
        "INSERT INTO agents (name, description, system_prompt, icon, model, max_tokens, temperature)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            req.name,
            req.description,
            req.system_prompt,
            req.icon,
            model,
            max_tokens,
            temperature,
        ],
    ) {
        Ok(_) => {
            let id = conn.last_insert_rowid();
            Json(ApiResponse::success(serde_json::json!({ "id": id, "message": "Agent created successfully" })))
        }
        Err(e) => Json(ApiResponse::error(format!("Failed to create agent: {}", e))),
    }
}

/// Update an existing agent
async fn update_agent(
    Path(id): Path<i64>,
    AxumState(state): AxumState<AppState>,
    Json(req): Json<UpdateAgentRequest>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    // Build dynamic SET clause
    let mut set_clauses = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(name) = &req.name {
        set_clauses.push("name = ?");
        params.push(Box::new(name.clone()));
    }
    if let Some(desc) = &req.description {
        set_clauses.push("description = ?");
        params.push(Box::new(desc.clone()));
    }
    if let Some(prompt) = &req.system_prompt {
        set_clauses.push("system_prompt = ?");
        params.push(Box::new(prompt.clone()));
    }
    if let Some(icon) = &req.icon {
        set_clauses.push("icon = ?");
        params.push(Box::new(icon.clone()));
    }
    if let Some(model) = &req.model {
        set_clauses.push("model = ?");
        params.push(Box::new(model.clone()));
    }
    if let Some(tokens) = req.max_tokens {
        set_clauses.push("max_tokens = ?");
        params.push(Box::new(tokens));
    }
    if let Some(temp) = req.temperature {
        set_clauses.push("temperature = ?");
        params.push(Box::new(temp));
    }

    if set_clauses.is_empty() {
        return Json(ApiResponse::error("No fields to update".to_string()));
    }

    // Add updated_at timestamp
    set_clauses.push("updated_at = strftime('%s', 'now')");
    params.push(Box::new(0i64)); // placeholder, not used

    // Add ID for WHERE clause
    params.push(Box::new(id));

    let query = format!(
        "UPDATE agents SET {} WHERE id = ?",
        set_clauses.join(", ")
    );

    match conn.execute(&query, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref()))) {
        Ok(0) => Json(ApiResponse::error("Agent not found".to_string())),
        Ok(_) => Json(ApiResponse::success(serde_json::json!({ "message": "Agent updated successfully" }))),
        Err(e) => Json(ApiResponse::error(format!("Failed to update agent: {}", e))),
    }
}

/// Delete an agent
async fn delete_agent(
    Path(id): Path<i64>,
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    match conn.execute("DELETE FROM agents WHERE id = ?", [id]) {
        Ok(0) => Json(ApiResponse::error("Agent not found".to_string())),
        Ok(_) => Json(ApiResponse::success(serde_json::json!({ "message": "Agent deleted successfully" }))),
        Err(e) => Json(ApiResponse::error(format!("Failed to delete agent: {}", e))),
    }
}

/// Get a single agent by ID
async fn get_agent(
    Path(id): Path<i64>,
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    match conn.query_row(
        "SELECT id, name, description, system_prompt, icon, model, max_tokens, temperature,
         read_enabled, write_enabled, network_enabled, created_at, updated_at
         FROM agents WHERE id = ?",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, Option<String>>(2)?,
                "system_prompt": row.get::<_, String>(3)?,
                "icon": row.get::<_, Option<String>>(4)?,
                "model": row.get::<_, String>(5)?,
                "max_tokens": row.get::<_, i64>(6)?,
                "temperature": row.get::<_, f64>(7)?,
                "read_enabled": row.get::<_, i64>(8)? != 0,
                "write_enabled": row.get::<_, i64>(9)? != 0,
                "network_enabled": row.get::<_, i64>(10)? != 0,
                "created_at": row.get::<_, i64>(11)?,
                "updated_at": row.get::<_, i64>(12)?,
            }))
        },
    ) {
        Ok(agent) => Json(ApiResponse::success(agent)),
        Err(_) => Json(ApiResponse::error("Agent not found".to_string())),
    }
}

/// List agent runs
async fn list_agent_runs(
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    let mut stmt = match conn.prepare(
        "SELECT ar.id, ar.agent_id, ar.project_path, ar.status, ar.prompt, ar.output,
                ar.error, ar.model, ar.tokens_used, ar.cost, ar.started_at, ar.completed_at,
                a.name as agent_name, a.icon as agent_icon
         FROM agent_runs ar
         JOIN agents a ON ar.agent_id = a.id
         ORDER BY ar.started_at DESC LIMIT 100"
    ) {
        Ok(s) => s,
        Err(e) => return Json(ApiResponse::error(format!("Failed to prepare query: {}", e))),
    };

    let runs: Vec<serde_json::Value> = match stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "agent_id": row.get::<_, i64>(1)?,
            "project_path": row.get::<_, String>(2)?,
            "status": row.get::<_, String>(3)?,
            "prompt": row.get::<_, Option<String>>(4)?,
            "output": row.get::<_, Option<String>>(5)?,
            "error": row.get::<_, Option<String>>(6)?,
            "model": row.get::<_, Option<String>>(7)?,
            "tokens_used": row.get::<_, Option<i64>>(8)?,
            "cost": row.get::<_, Option<f64>>(9)?,
            "created_at": row.get::<_, i64>(10)?,
            "completed_at": row.get::<_, Option<i64>>(11)?,
            "agent_name": row.get::<_, String>(12)?,
            "agent_icon": row.get::<_, Option<String>>(13)?,
        }))
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };

    Json(ApiResponse::success(runs))
}

/// Router for agents CRUD operations
fn agents_router() -> MethodRouter<AppState> {
    MethodRouter::<AppState>::new()
        .get(get_agents)
        .post(create_agent)
}

/// Router for single agent operations
fn agent_router() -> MethodRouter<AppState> {
    MethodRouter::<AppState>::new()
        .get(get_agent)
        .put(update_agent)
        .delete(delete_agent)
}

/// Router for agent runs
fn agent_runs_router() -> MethodRouter<AppState> {
    MethodRouter::<AppState>::new()
        .get(list_agent_runs)
}

/// Get usage statistics from agent runs
async fn get_usage(AxumState(state): AxumState<AppState>) -> impl axum::response::IntoResponse {
    let conn_result = get_db_connection(&state.db_path);
    let conn = match conn_result {
        Ok(c) => c,
        Err(e) => return Json(ApiResponse::error(e)),
    };

    // Get summary stats
    let total_runs: i64 = conn.query_row("SELECT COUNT(*) FROM agent_runs", [], |row| row.get(0)).unwrap_or(0);
    let total_cost: f64 = conn.query_row("SELECT SUM(cost) FROM agent_runs", [], |row| row.get(0)).unwrap_or(0.0);
    let total_tokens: i64 = conn.query_row("SELECT SUM(tokens_used) FROM agent_runs", [], |row| row.get(0)).unwrap_or(0);
    let completed_runs: i64 = conn.query_row("SELECT COUNT(*) FROM agent_runs WHERE status = 'completed'", [], |row| row.get(0)).unwrap_or(0);
    let failed_runs: i64 = conn.query_row("SELECT COUNT(*) FROM agent_runs WHERE status = 'failed'", [], |row| row.get(0)).unwrap_or(0);

    // Get usage by model
    let mut model_stmt = match conn.prepare(
        "SELECT model, COUNT(*) as count, SUM(cost) as total_cost, SUM(tokens_used) as total_tokens
         FROM agent_runs WHERE model IS NOT NULL GROUP BY model"
    ) {
        Ok(s) => s,
        Err(_) => return Json(ApiResponse::error("Failed to prepare model query".to_string())),
    };

    let by_model: Vec<serde_json::Value> = match model_stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "model": row.get::<_, Option<String>>(0)?,
            "count": row.get::<_, i64>(1)?,
            "cost": row.get::<_, Option<f64>>(2)?,
            "tokens": row.get::<_, Option<i64>>(3)?,
        }))
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };

    // Get usage by date (last 30 days)
    let date_stmt_result = conn.prepare(
        "SELECT DATE(started_at, 'unixepoch') as date, COUNT(*) as count, SUM(cost) as cost
         FROM agent_runs WHERE started_at > strftime('%s', 'now') - 86400 * 30
         GROUP BY DATE(started_at, 'unixepoch') ORDER BY date"
    );

    let by_date: Vec<serde_json::Value> = match date_stmt_result {
        Ok(mut date_stmt) => match date_stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "date": row.get::<_, Option<String>>(0)?,
                "count": row.get::<_, i64>(1)?,
                "cost": row.get::<_, Option<f64>>(2)?,
            }))
        }) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(_) => vec![],
        },
        Err(_) => vec![],
    };

    let usage_stats = serde_json::json!({
        "total_runs": total_runs,
        "total_cost": total_cost,
        "total_tokens": total_tokens,
        "completed_runs": completed_runs,
        "failed_runs": failed_runs,
        "by_model": by_model,
        "by_date": by_date,
    });

    Json(ApiResponse::success(usage_stats))
}

/// Get user's home directory
async fn get_home_directory() -> impl axum::response::IntoResponse {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());
    Json(ApiResponse::success(home))
}

/// Browse directory contents on server
async fn browse_directory(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl axum::response::IntoResponse {
    let path = params.get("path").cloned().unwrap_or_else(|| "/".to_string());
    
    match std::fs::read_dir(&path) {
        Ok(entries) => {
            let mut items = Vec::new();
            for entry in entries.flatten() {
                let path = entry.path();
                let is_dir = path.is_dir();
                let name = entry.file_name().to_string_lossy().to_string();
                items.push(serde_json::json!({
                    "name": name,
                    "path": path.to_string_lossy(),
                    "isDir": is_dir,
                }));
            }
            // Sort: directories first, then files, alphabetically
            items.sort_by(|a, b| {
                let a_dir = a["isDir"].as_bool().unwrap_or(false);
                let b_dir = b["isDir"].as_bool().unwrap_or(false);
                if a_dir != b_dir {
                    return b_dir.cmp(&a_dir); // directories first
                }
                a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
            });
            Json(ApiResponse::success(serde_json::json!({
                "path": path,
                "items": items,
            })))
        }
        Err(e) => Json(ApiResponse::error(format!("Failed to read directory: {}", e))),
    }
}

/// Get directory tree for navigation (limited depth)
async fn get_directory_tree(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl axum::response::IntoResponse {
    let root_path = params.get("path").cloned().unwrap_or_else(|| "/".to_string());
    
    fn build_tree(path: &std::path::Path, depth: usize, max_depth: usize) -> Option<serde_json::Value> {
        if depth > max_depth {
            return None;
        }
        
        if !path.exists() || !path.is_dir() {
            return None;
        }
        
        let mut children = Vec::new();
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let child_path = entry.path();
                if child_path.is_dir() {
                    if let Some(child_tree) = build_tree(&child_path, depth + 1, max_depth) {
                        children.push(child_tree);
                    }
                }
            }
        }
        
        // Sort children by name
        children.sort_by(|a, b| {
            let a_name = a["name"].as_str().unwrap_or("");
            let b_name = b["name"].as_str().unwrap_or("");
            a_name.cmp(b_name)
        });
        
        Some(serde_json::json!({
            "name": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string_lossy().to_string()),
            "path": path.to_string_lossy(),
            "children": children,
        }))
    }
    
    let root = std::path::Path::new(&root_path);
    match build_tree(root, 0, 2) {
        Some(tree) => Json(ApiResponse::success(tree)),
        None => Json(ApiResponse::error("Invalid path".to_string())),
    }
}

/// Check if a path is a valid project directory
async fn validate_project_path(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl axum::response::IntoResponse {
    let path = params.get("path").cloned().unwrap_or_default();
    
    if path.is_empty() {
        return Json(ApiResponse::error("Path is required".to_string()));
    }
    
    let path = std::path::Path::new(&path);
    if !path.exists() {
        return Json(ApiResponse::error("Path does not exist".to_string()));
    }
    
    if !path.is_dir() {
        return Json(ApiResponse::error("Path is not a directory".to_string()));
    }
    
    Json(ApiResponse::success(serde_json::json!({
        "valid": true,
        "path": path.to_string_lossy(),
    })))
}

/// Get Claude settings - return basic defaults for web mode
async fn get_claude_settings() -> Json<ApiResponse<serde_json::Value>> {
    let default_settings = serde_json::json!({
        "data": {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 8192,
            "temperature": 0.0,
            "auto_save": true,
            "theme": "dark"
        }
    });
    Json(ApiResponse::success(default_settings))
}

/// Check Claude version - return mock status for web mode
async fn check_claude_version() -> Json<ApiResponse<serde_json::Value>> {
    let version_status = serde_json::json!({
        "status": "ok",
        "version": "web-mode",
        "message": "Running in web server mode"
    });
    Json(ApiResponse::success(version_status))
}

/// List all available Claude installations on the system
async fn list_claude_installations(
) -> Json<ApiResponse<Vec<crate::claude_binary::ClaudeInstallation>>> {
    let installations = crate::claude_binary::discover_claude_installations();

    if installations.is_empty() {
        Json(ApiResponse::error(
            "No Claude Code installations found on the system".to_string(),
        ))
    } else {
        Json(ApiResponse::success(installations))
    }
}

/// Get system prompt - return default for web mode
async fn get_system_prompt() -> Json<ApiResponse<String>> {
    let default_prompt =
        "You are Claude, an AI assistant created by Anthropic. You are running in web server mode."
            .to_string();
    Json(ApiResponse::success(default_prompt))
}

/// Open new session - mock for web mode
async fn open_new_session() -> Json<ApiResponse<String>> {
    let session_id = format!("web-session-{}", chrono::Utc::now().timestamp());
    Json(ApiResponse::success(session_id))
}

/// List slash commands - return empty for web mode
async fn list_slash_commands() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    Json(ApiResponse::success(vec![]))
}

/// List MCP servers - returns empty for now (MCP storage not implemented in web mode)
async fn mcp_list() -> impl axum::response::IntoResponse {
    Json(ApiResponse::success(vec![] as Vec<serde_json::Value>))
}

/// Add MCP server
async fn mcp_add(
    AxumState(_state): AxumState<AppState>,
    Json(_req): Json<serde_json::Value>,
) -> impl axum::response::IntoResponse {
    // For now, just acknowledge the request
    // Full MCP management would require a separate table
    Json(ApiResponse::success(serde_json::json!({
        "message": "MCP server addition not yet implemented in web mode"
    })))
}

/// Load session history from JSONL file
async fn load_session_history(
    Path((session_id, project_id)): Path<(String, String)>,
) -> Json<ApiResponse<Vec<serde_json::Value>>> {
    match commands::claude::load_session_history(session_id, project_id).await {
        Ok(history) => Json(ApiResponse::success(history)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// List running Claude sessions
async fn list_running_claude_sessions() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    // Return empty for web mode - no actual Claude processes in web mode
    Json(ApiResponse::success(vec![]))
}

/// Execute Claude code - mock for web mode
async fn execute_claude_code() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::error("Claude execution is not available in web mode. Please use the desktop app for running Claude commands.".to_string()))
}

/// Continue Claude code - mock for web mode
async fn continue_claude_code() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::error("Claude execution is not available in web mode. Please use the desktop app for running Claude commands.".to_string()))
}

/// Resume Claude code - mock for web mode  
async fn resume_claude_code() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::error("Claude execution is not available in web mode. Please use the desktop app for running Claude commands.".to_string()))
}

/// Cancel Claude execution
async fn cancel_claude_execution(Path(session_id): Path<String>) -> Json<ApiResponse<()>> {
    // In web mode, we don't have a way to cancel the subprocess cleanly
    // The WebSocket closing should handle cleanup
    println!("[TRACE] Cancel request for session: {}", session_id);
    Json(ApiResponse::success(()))
}

/// Get Claude session output
async fn get_claude_session_output(Path(session_id): Path<String>) -> Json<ApiResponse<String>> {
    // In web mode, output is streamed via WebSocket, not stored
    println!("[TRACE] Output request for session: {}", session_id);
    Json(ApiResponse::success(
        "Output available via WebSocket only".to_string(),
    ))
}

/// WebSocket handler for Claude execution with streaming output
async fn claude_websocket(ws: WebSocketUpgrade, AxumState(state): AxumState<AppState>) -> Response {
    ws.on_upgrade(move |socket| claude_websocket_handler(socket, state))
}

async fn claude_websocket_handler(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let session_id = uuid::Uuid::new_v4().to_string();

    println!(
        "[TRACE] WebSocket handler started - session_id: {}",
        session_id
    );

    // Channel for sending output to WebSocket
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);

    // Store session in state
    {
        let mut sessions = state.active_sessions.lock().await;
        sessions.insert(session_id.clone(), tx);
        println!(
            "[TRACE] Session stored in state - active sessions count: {}",
            sessions.len()
        );
    }

    // Task to forward channel messages to WebSocket
    let session_id_for_forward = session_id.clone();
    let forward_task = tokio::spawn(async move {
        println!(
            "[TRACE] Forward task started for session {}",
            session_id_for_forward
        );
        while let Some(message) = rx.recv().await {
            println!("[TRACE] Forwarding message to WebSocket: {}", message);
            if sender.send(Message::Text(message.into())).await.is_err() {
                println!("[TRACE] Failed to send message to WebSocket - connection closed");
                break;
            }
        }
        println!(
            "[TRACE] Forward task ended for session {}",
            session_id_for_forward
        );
    });

    // Handle incoming messages from WebSocket
    println!("[TRACE] Starting to listen for WebSocket messages");
    while let Some(msg) = receiver.next().await {
        println!("[TRACE] Received WebSocket message: {:?}", msg);
        if let Ok(msg) = msg {
            if let Message::Text(text) = msg {
                println!(
                    "[TRACE] WebSocket text message received - length: {} chars",
                    text.len()
                );
                println!("[TRACE] WebSocket message content: {}", text);
                match serde_json::from_str::<ClaudeExecutionRequest>(&text) {
                    Ok(request) => {
                        println!("[TRACE] Successfully parsed request: {:?}", request);
                        println!("[TRACE] Command type: {}", request.command_type);
                        println!("[TRACE] Project path: {}", request.project_path);
                        println!("[TRACE] Prompt length: {} chars", request.prompt.len());

                        // Execute Claude command based on request type
                        let session_id_clone = session_id.clone();
                        let state_clone = state.clone();

                        println!(
                            "[TRACE] Spawning task to execute command: {}",
                            request.command_type
                        );
                        tokio::spawn(async move {
                            println!("[TRACE] Task started for command execution");
                            let result = match request.command_type.as_str() {
                                "execute" => {
                                    println!("[TRACE] Calling execute_claude_command");
                                    execute_claude_command(
                                        request.project_path,
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        state_clone.clone(),
                                    )
                                    .await
                                }
                                "continue" => {
                                    println!("[TRACE] Calling continue_claude_command");
                                    continue_claude_command(
                                        request.project_path,
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        state_clone.clone(),
                                    )
                                    .await
                                }
                                "resume" => {
                                    println!("[TRACE] Calling resume_claude_command");
                                    resume_claude_command(
                                        request.project_path,
                                        request.session_id.unwrap_or_default(),
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        state_clone.clone(),
                                    )
                                    .await
                                }
                                _ => {
                                    println!(
                                        "[TRACE] Unknown command type: {}",
                                        request.command_type
                                    );
                                    Err("Unknown command type".to_string())
                                }
                            };

                            println!(
                                "[TRACE] Command execution finished with result: {:?}",
                                result
                            );

                            // Send completion message
                            let sender_opt = state_clone
                                .active_sessions
                                .lock().await
                                .get(&session_id_clone)
                                .cloned();
                            if let Some(sender) = sender_opt {
                                let completion_msg = match result {
                                    Ok(_) => json!({
                                        "type": "completion",
                                        "status": "success"
                                    }),
                                    Err(e) => json!({
                                        "type": "completion",
                                        "status": "error",
                                        "error": e
                                    }),
                                };
                                println!("[TRACE] Sending completion message: {}", completion_msg);
                                let _ = sender.send(completion_msg.to_string()).await;
                            } else {
                                println!("[TRACE] Session not found in active sessions when sending completion");
                            }
                        });
                    }
                    Err(e) => {
                        println!("[TRACE] Failed to parse WebSocket request: {}", e);
                        println!("[TRACE] Raw message that failed to parse: {}", text);

                        // Send error back to client
                        let error_msg = json!({
                            "type": "error",
                            "message": format!("Failed to parse request: {}", e)
                        });
                        // Clone sender before awaiting to avoid holding lock across await
                        let sender_opt = state.active_sessions.lock().await.get(&session_id).cloned();
                        if let Some(sender_tx) = sender_opt {
                            let _ = sender_tx.send(error_msg.to_string()).await;
                        }
                    }
                }
            } else if let Message::Close(_) = msg {
                println!("[TRACE] WebSocket close message received");
                break;
            } else {
                println!("[TRACE] Non-text WebSocket message received: {:?}", msg);
            }
        } else {
            println!("[TRACE] Error receiving WebSocket message");
        }
    }

    println!("[TRACE] WebSocket message loop ended");

    // Clean up session
    {
        let mut sessions = state.active_sessions.lock().await;
        sessions.remove(&session_id);
        println!(
            "[TRACE] Session {} removed from state - remaining sessions: {}",
            session_id,
            sessions.len()
        );
    }

    forward_task.abort();
    println!("[TRACE] WebSocket handler ended for session {}", session_id);
}

// Claude command execution functions for WebSocket streaming
async fn execute_claude_command(
    project_path: String,
    prompt: String,
    model: String,
    session_id: String,
    state: AppState,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    println!("[TRACE] execute_claude_command called:");
    println!("[TRACE]   project_path: {}", project_path);
    println!("[TRACE]   prompt length: {} chars", prompt.len());
    println!("[TRACE]   model: {}", model);
    println!("[TRACE]   session_id: {}", session_id);

    // Send initial message
    println!("[TRACE] Sending initial start message");
    send_to_session(
        &state,
        &session_id,
        json!({
            "type": "start",
            "message": "Starting Claude execution..."
        })
        .to_string(),
    )
    .await;

    // Find Claude binary (simplified for web mode)
    println!("[TRACE] Finding Claude binary...");
    let claude_path = find_claude_binary_web().map_err(|e| {
        let error = format!("Claude binary not found: {}", e);
        println!("[TRACE] Error finding Claude binary: {}", error);
        error
    })?;
    println!("[TRACE] Found Claude binary: {}", claude_path);

    // Create Claude command
    println!("[TRACE] Creating Claude command...");
    let mut cmd = Command::new(&claude_path);
    let args = [
        "-p",
        &prompt,
        "--model",
        &model,
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
    ];
    cmd.args(args);
    cmd.current_dir(&project_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    println!(
        "[TRACE] Command: {} {:?} (in dir: {})",
        claude_path, args, project_path
    );

    // Spawn Claude process
    println!("[TRACE] Spawning Claude process...");
    let mut child = cmd.spawn().map_err(|e| {
        let error = format!("Failed to spawn Claude: {}", e);
        println!("[TRACE] Spawn error: {}", error);
        error
    })?;
    println!("[TRACE] Claude process spawned successfully");

    // Get stdout for streaming
    let stdout = child.stdout.take().ok_or_else(|| {
        println!("[TRACE] Failed to get stdout from child process");
        "Failed to get stdout".to_string()
    })?;
    let stdout_reader = BufReader::new(stdout);

    println!("[TRACE] Starting to read Claude output...");
    // Stream output line by line
    let mut lines = stdout_reader.lines();
    let mut line_count = 0;
    while let Ok(Some(line)) = lines.next_line().await {
        line_count += 1;
        println!("[TRACE] Claude output line {}: {}", line_count, line);

        // Send each line to WebSocket
        let message = json!({
            "type": "output",
            "content": line
        })
        .to_string();
        println!("[TRACE] Sending output message to session: {}", message);
        send_to_session(&state, &session_id, message).await;
    }

    println!(
        "[TRACE] Finished reading Claude output ({} lines total)",
        line_count
    );

    // Wait for process to complete
    println!("[TRACE] Waiting for Claude process to complete...");
    let exit_status = child.wait().await.map_err(|e| {
        let error = format!("Failed to wait for Claude: {}", e);
        println!("[TRACE] Wait error: {}", error);
        error
    })?;

    println!(
        "[TRACE] Claude process completed with status: {:?}",
        exit_status
    );

    if !exit_status.success() {
        let error = format!(
            "Claude execution failed with exit code: {:?}",
            exit_status.code()
        );
        println!("[TRACE] Claude execution failed: {}", error);
        return Err(error);
    }

    println!("[TRACE] execute_claude_command completed successfully");
    Ok(())
}

async fn continue_claude_command(
    project_path: String,
    prompt: String,
    model: String,
    session_id: String,
    state: AppState,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    send_to_session(
        &state,
        &session_id,
        json!({
            "type": "start",
            "message": "Continuing Claude session..."
        })
        .to_string(),
    )
    .await;

    // Find Claude binary
    let claude_path =
        find_claude_binary_web().map_err(|e| format!("Claude binary not found: {}", e))?;

    // Create continue command
    let mut cmd = Command::new(&claude_path);
    cmd.args([
        "-c", // Continue flag
        "-p",
        &prompt,
        "--model",
        &model,
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
    ]);
    cmd.current_dir(&project_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // Spawn and stream output
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stdout_reader = BufReader::new(stdout);

    let mut lines = stdout_reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        send_to_session(
            &state,
            &session_id,
            json!({
                "type": "output",
                "content": line
            })
            .to_string(),
        )
        .await;
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for Claude: {}", e))?;
    if !exit_status.success() {
        return Err(format!(
            "Claude execution failed with exit code: {:?}",
            exit_status.code()
        ));
    }

    Ok(())
}

async fn resume_claude_command(
    project_path: String,
    claude_session_id: String,
    prompt: String,
    model: String,
    session_id: String,
    state: AppState,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    println!("[resume_claude_command] Starting with project_path: {}, claude_session_id: {}, prompt: {}, model: {}", 
             project_path, claude_session_id, prompt, model);

    // Convert agent-xxx format to real session UUID if needed
    let real_session_id = if claude_session_id.starts_with("agent-") {
        let agent_id = &claude_session_id[6..];
        let agent_file_path = format!("{}/agent-{}.jsonl", 
            project_path.trim_end_matches('/'),
            agent_id);
        println!("[resume_claude_command] Looking for agent session file: {}", agent_file_path);
        
        if let Ok(content) = tokio::fs::read_to_string(&agent_file_path).await {
            if let Some(session_start) = content.find("\"sessionId\":\"") {
                let session_part = &content[session_start + 13..];
                if let Some(session_end) = session_part.find('\"') {
                    let uuid = &session_part[..session_end];
                    println!("[resume_claude_command] Found real session UUID: {}", uuid);
                    uuid.to_string()
                } else {
                    claude_session_id
                }
            } else {
                claude_session_id
            }
        } else if let Some(home_dir) = dirs::home_dir() {
            let project_name = project_path.trim_start_matches('/');
            let project_dir = project_name.replace('/', "-").replace("\\", "-");
            let alt_path = format!("{}/.claude/projects/{}/{}.jsonl", 
                home_dir.display(),
                project_dir,
                claude_session_id);
            
            if let Ok(content) = tokio::fs::read_to_string(&alt_path).await {
                if let Some(session_start) = content.find("\"sessionId\":\"") {
                    let session_part = &content[session_start + 13..];
                    if let Some(session_end) = session_part.find('\"') {
                        let uuid = &session_part[..session_end];
                        println!("[resume_claude_command] Found real session UUID: {}", uuid);
                        uuid.to_string()
                    } else {
                        claude_session_id
                    }
                } else {
                    claude_session_id
                }
            } else {
                claude_session_id
            }
        } else {
            claude_session_id
        }
    } else {
        claude_session_id
    };

    send_to_session(
        &state,
        &session_id,
        json!({
            "type": "start",
            "message": "Resuming Claude session..."
        })
        .to_string(),
    )
    .await;

    // Find Claude binary
    println!("[resume_claude_command] Finding Claude binary...");
    let claude_path =
        find_claude_binary_web().map_err(|e| format!("Claude binary not found: {}", e))?;
    println!(
        "[resume_claude_command] Found Claude binary: {}",
        claude_path
    );

    // Create resume command
    println!("[resume_claude_command] Creating command...");
    let mut cmd = Command::new(&claude_path);
    let args = [
        "--resume",
        &real_session_id,
        "-p",
        &prompt,
        "--model",
        &model,
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
    ];
    cmd.args(args);
    cmd.current_dir(&project_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    println!(
        "[resume_claude_command] Command: {} {:?} (in dir: {})",
        claude_path, args, project_path
    );

    // Spawn and stream output
    println!("[resume_claude_command] Spawning process...");
    let mut child = cmd.spawn().map_err(|e| {
        let error = format!("Failed to spawn Claude: {}", e);
        println!("[resume_claude_command] Spawn error: {}", error);
        error
    })?;
    println!("[resume_claude_command] Process spawned successfully");
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stdout_reader = BufReader::new(stdout);

    let mut lines = stdout_reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        send_to_session(
            &state,
            &session_id,
            json!({
                "type": "output",
                "content": line
            })
            .to_string(),
        )
        .await;
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for Claude: {}", e))?;
    if !exit_status.success() {
        return Err(format!(
            "Claude execution failed with exit code: {:?}",
            exit_status.code()
        ));
    }

    Ok(())
}

async fn send_to_session(state: &AppState, session_id: &str, message: String) {
    println!("[TRACE] send_to_session called for session: {}", session_id);
    println!("[TRACE] Message: {}", message);

    let sessions = state.active_sessions.lock().await;
    let sender_opt = sessions.get(session_id).cloned();
    drop(sessions); // Release the lock before awaiting
    
    if let Some(sender) = sender_opt {
        println!("[TRACE] Found session in active sessions, sending message...");
        match sender.send(message).await {
            Ok(_) => println!("[TRACE] Message sent successfully"),
            Err(e) => println!("[TRACE] Failed to send message: {}", e),
        }
    } else {
        println!(
            "[TRACE] Session {} not found in active sessions",
            session_id
        );
        let sessions = state.active_sessions.lock().await;
        println!(
            "[TRACE] Active sessions: {:?}",
            sessions.keys().collect::<Vec<_>>()
        );
    }
}

/// Create the web server
pub async fn create_web_server(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let db_path = init_web_db()?;

    let state = AppState {
        active_sessions: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        db_path,
        process_registry: Arc::new(crate::process::registry::ProcessRegistry::new()),
    };

    // CORS layer to allow requests from phone browsers
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any);

    // Create router with API endpoints
    let app = Router::new()
        // Frontend routes
        .route("/", get(serve_frontend))
        .route("/index.html", get(serve_frontend))
        // API routes (REST API equivalent of Tauri commands)
        .route("/api/home", get(get_home_directory))
        .route("/api/browse", get(browse_directory))
        .route("/api/browse/tree", get(get_directory_tree))
        .route("/api/validate-path", get(validate_project_path))
        .route("/api/projects", get(get_projects).post(create_project))
        .route("/api/projects/{project_id}/sessions", get(get_sessions))
        // Agents API
        .route("/api/agents", agents_router())
        .route("/api/agents/{id}", agent_router())
        .route("/api/agents/runs", agent_runs_router())
        // Usage API
        .route("/api/usage", get(get_usage))
        // Storage API
        .route("/api/storage/tables", get(storage_list_tables))
        .route("/api/storage/tables/{tableName}", get(storage_read_table))
        .route(
            "/api/storage/tables/{tableName}/rows",
            storage_rows_router(),
        )
        // Settings and configuration
        .route("/api/settings/claude", get(get_claude_settings))
        .route("/api/settings/claude/version", get(check_claude_version))
        .route(
            "/api/settings/claude/installations",
            get(list_claude_installations),
        )
        .route("/api/settings/system-prompt", get(get_system_prompt))
        // Session management
        .route("/api/sessions/new", get(open_new_session))
        // Slash commands
        .route("/api/slash-commands", get(list_slash_commands))
        // MCP
        .route("/api/mcp/servers", get(mcp_list).post(mcp_add))
        // Process Monitor
        .route("/api/processes", get(get_all_processes_web))
        .route("/api/processes/stats", get(get_process_stats_web))
        .route("/api/processes/kill/all", post(kill_all_processes_web).delete(kill_all_processes_web))
        .route("/api/processes/kill/claude-sessions", post(kill_all_claude_sessions_web).delete(kill_all_claude_sessions_web))
        .route("/api/processes/kill/agent-runs", post(kill_all_agent_runs_web).delete(kill_all_agent_runs_web))
        .route("/api/processes/{runId}/kill", post(kill_process_web).delete(kill_process_web))
        // Session history
        .route(
            "/api/sessions/{session_id}/history/{project_id}",
            get(load_session_history),
        )
        .route("/api/sessions/running", get(list_running_claude_sessions))
        // Claude execution endpoints (read-only in web mode)
        .route("/api/sessions/execute", get(execute_claude_code))
        .route("/api/sessions/continue", get(continue_claude_code))
        .route("/api/sessions/resume", get(resume_claude_code))
        .route(
            "/api/sessions/{sessionId}/cancel",
            get(cancel_claude_execution),
        )
        .route(
            "/api/sessions/{sessionId}/output",
            get(get_claude_session_output),
        )
        // WebSocket endpoint for real-time Claude execution
        .route("/ws/claude", get(claude_websocket))
        // Serve static assets
        .nest_service("/assets", ServeDir::new("../dist/assets"))
        .nest_service("/vite.svg", ServeDir::new("../dist/vite.svg"))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("🌐 Web server running on http://0.0.0.0:{}", port);
    println!("📱 Access from phone: http://YOUR_PC_IP:{}", port);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Start web server mode (alternative to Tauri GUI)
pub async fn start_web_mode(port: Option<u16>) -> Result<(), Box<dyn std::error::Error>> {
    let port = port.unwrap_or(8080);

    println!("🚀 Starting Opcode in web server mode...");
    create_web_server(port).await
}

// ============ Process Monitor API Endpoints ============

/// Get all running processes
async fn get_all_processes_web(
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let result = state.process_registry.get_running_processes();

    match result {
        Ok(processes) => {
            let now = chrono::Utc::now();
            let monitor_info: Vec<crate::commands::process_monitor::ProcessMonitorInfo> = processes
                .into_iter()
                .map(|p| {
                    let duration = now.signed_duration_since(p.started_at);

                    let (process_type, session_id, agent_id, agent_name) = match p.process_type {
                        crate::process::registry::ProcessType::ClaudeSession { session_id } => (
                            "claude_session".to_string(),
                            Some(session_id),
                            None,
                            None,
                        ),
                        crate::process::registry::ProcessType::AgentRun {
                            agent_id,
                            agent_name,
                        } => (
                            "agent_run".to_string(),
                            None,
                            Some(agent_id),
                            Some(agent_name),
                        ),
                    };

                    crate::commands::process_monitor::ProcessMonitorInfo {
                        run_id: p.run_id,
                        pid: p.pid,
                        process_type,
                        session_id,
                        agent_id,
                        agent_name,
                        started_at: p.started_at.to_rfc3339(),
                        project_path: p.project_path,
                        task: p.task,
                        model: p.model,
                        duration_seconds: duration.num_seconds(),
                    }
                })
                .collect();

            Json(ApiResponse::success(monitor_info))
        }
        Err(e) => Json(ApiResponse::<Vec<crate::commands::process_monitor::ProcessMonitorInfo>>::error(e)),
    }
}

/// Get process statistics
async fn get_process_stats_web(
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let processes = state.process_registry.get_running_processes();

    match processes {
        Ok(processes) => {
            let claude_sessions = state
                .process_registry
                .get_running_claude_sessions();
            let agent_runs = state
                .process_registry
                .get_running_agent_processes();

            match (claude_sessions, agent_runs) {
                (Ok(sessions), Ok(agents)) => {
                    let stats = crate::commands::process_monitor::ProcessMonitorStats {
                        total_processes: processes.len(),
                        claude_sessions: sessions.len(),
                        agent_runs: agents.len(),
                    };
                    Json(ApiResponse::success(stats))
                }
                _ => Json(ApiResponse::<crate::commands::process_monitor::ProcessMonitorStats>::error(
                    "Failed to get process details".to_string(),
                )),
            }
        }
        Err(e) => Json(ApiResponse::<crate::commands::process_monitor::ProcessMonitorStats>::error(e)),
    }
}

/// Kill a specific process by run_id
async fn kill_process_web(
    Path(run_id): Path<i64>,
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let result = state.process_registry.kill_process(run_id).await;

    match result {
        Ok(killed) => Json(ApiResponse::success(killed)),
        Err(e) => Json(ApiResponse::<bool>::error(e)),
    }
}

/// Kill all processes
async fn kill_all_processes_web(
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let processes = state.process_registry.get_running_processes();
    let mut killed_count = 0;

    if let Ok(processes) = processes {
        for process in processes {
            match state.process_registry.kill_process(process.run_id).await {
                Ok(true) => killed_count += 1,
                Ok(false) => {
                    log::warn!("Process {} was not found", process.run_id);
                }
                Err(e) => {
                    log::error!("Failed to kill process {}: {}", process.run_id, e);
                }
            }
        }
    }

    Json(ApiResponse::success(killed_count))
}

/// Kill all Claude sessions
async fn kill_all_claude_sessions_web(
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let sessions = state.process_registry.get_running_claude_sessions();
    let mut killed_count = 0;

    if let Ok(sessions) = sessions {
        for session in sessions {
            match state.process_registry.kill_process(session.run_id).await {
                Ok(true) => killed_count += 1,
                Ok(false) => {
                    log::warn!("Session {} was not found", session.run_id);
                }
                Err(e) => {
                    log::error!("Failed to kill session {}: {}", session.run_id, e);
                }
            }
        }
    }

    Json(ApiResponse::success(killed_count))
}

/// Kill all agent runs
async fn kill_all_agent_runs_web(
    AxumState(state): AxumState<AppState>,
) -> impl axum::response::IntoResponse {
    let agents = state.process_registry.get_running_agent_processes();
    let mut killed_count = 0;

    if let Ok(agents) = agents {
        for agent in agents {
            match state.process_registry.kill_process(agent.run_id).await {
                Ok(true) => killed_count += 1,
                Ok(false) => {
                    log::warn!("Agent run {} was not found", agent.run_id);
                }
                Err(e) => {
                    log::error!("Failed to kill agent run {}: {}", agent.run_id, e);
                }
            }
        }
    }

    Json(ApiResponse::success(killed_count))
}
