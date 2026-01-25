use crate::process::registry::ProcessRegistryState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessMonitorInfo {
    pub run_id: i64,
    pub pid: u32,
    pub process_type: String,
    pub session_id: Option<String>,
    pub agent_id: Option<i64>,
    pub agent_name: Option<String>,
    pub started_at: String,
    pub project_path: String,
    pub task: String,
    pub model: String,
    pub duration_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessMonitorStats {
    pub total_processes: usize,
    pub claude_sessions: usize,
    pub agent_runs: usize,
}

#[tauri::command]
pub async fn get_all_processes(
    registry: State<'_, ProcessRegistryState>,
) -> Result<Vec<ProcessMonitorInfo>, String> {
    let processes = registry
        .0
        .get_running_processes()
        .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now();

    let monitor_info: Vec<ProcessMonitorInfo> = processes
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

            ProcessMonitorInfo {
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

    Ok(monitor_info)
}

#[tauri::command]
pub async fn get_process_stats(
    registry: State<'_, ProcessRegistryState>,
) -> Result<ProcessMonitorStats, String> {
    let processes = registry
        .0
        .get_running_processes()
        .map_err(|e| e.to_string())?;

    let claude_sessions = registry
        .0
        .get_running_claude_sessions()
        .map_err(|e| e.to_string())?
        .len();

    let agent_runs = registry
        .0
        .get_running_agent_processes()
        .map_err(|e| e.to_string())?
        .len();

    Ok(ProcessMonitorStats {
        total_processes: processes.len(),
        claude_sessions,
        agent_runs,
    })
}

#[tauri::command]
pub async fn kill_process_by_run_id(
    run_id: i64,
    registry: State<'_, ProcessRegistryState>,
) -> Result<bool, String> {
    registry
        .0
        .kill_process(run_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kill_all_processes(
    registry: State<'_, ProcessRegistryState>,
) -> Result<usize, String> {
    let processes = registry
        .0
        .get_running_processes()
        .map_err(|e| e.to_string())?;

    let mut killed_count = 0;

    for process in processes {
        match registry.0.kill_process(process.run_id).await {
            Ok(true) => killed_count += 1,
            Ok(false) => {
                log::warn!("Process {} was not found", process.run_id);
            }
            Err(e) => {
                log::error!("Failed to kill process {}: {}", process.run_id, e);
            }
        }
    }

    Ok(killed_count)
}

#[tauri::command]
pub async fn kill_all_claude_sessions(
    registry: State<'_, ProcessRegistryState>,
) -> Result<usize, String> {
    let sessions = registry
        .0
        .get_running_claude_sessions()
        .map_err(|e| e.to_string())?;

    let mut killed_count = 0;

    for session in sessions {
        match registry.0.kill_process(session.run_id).await {
            Ok(true) => killed_count += 1,
            Ok(false) => {
                log::warn!("Session {} was not found", session.run_id);
            }
            Err(e) => {
                log::error!("Failed to kill session {}: {}", session.run_id, e);
            }
        }
    }

    Ok(killed_count)
}

#[tauri::command]
pub async fn kill_all_agent_runs(
    registry: State<'_, ProcessRegistryState>,
) -> Result<usize, String> {
    let agents = registry
        .0
        .get_running_agent_processes()
        .map_err(|e| e.to_string())?;

    let mut killed_count = 0;

    for agent in agents {
        match registry.0.kill_process(agent.run_id).await {
            Ok(true) => killed_count += 1,
            Ok(false) => {
                log::warn!("Agent run {} was not found", agent.run_id);
            }
            Err(e) => {
                log::error!("Failed to kill agent run {}: {}", agent.run_id, e);
            }
        }
    }

    Ok(killed_count)
}
