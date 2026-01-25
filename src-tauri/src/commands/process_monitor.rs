use crate::process::registry::{ProcessInfo, ProcessRegistryState, ProcessType};
use serde::{Deserialize, Serialize};
use std::process::Command;
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

/// Discover all running Claude Code processes on the system
/// This includes processes NOT started through the web server
pub fn discover_system_claude_processes() -> Vec<ProcessInfo> {
    let mut discovered_processes = Vec::new();

    // Use 'ps' command to find all running Claude processes
    let output = if cfg!(target_os = "linux") || cfg!(target_os = "macos") {
        Command::new("ps")
            .args(["-u", std::env::var("USER").unwrap_or_else(|_| String::from("")).as_str(), "-o", "pid=", "-o", "lstart=", "-o", "args="])
            .output()
    } else {
        // Windows: use tasklist
        Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
    };

    match output {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);

                // Parse ps output
                for line in stdout.lines() {
                    let line = line.trim();
                    if line.is_empty() || !line.contains("claude") {
                        continue;
                    }

                    // Skip MCP server processes and other auxiliary processes
                    if line.contains("mcp-server") || line.contains("worker-service") {
                        continue;
                    }

                    // Parse ps output format: PID START_TIME COMMAND
                    // Example: "12345 Fri Jan 25 21:20:00 2026 /home/user/.local/bin/claude ..."
                    // lstart format is: "Day Month Day HH:MM:SS YYYY" (e.g., "Fri Jan 25 21:20:00 2026")
                    // We need to skip the PID and the date/time (5 tokens: day, month, day_of_month, time, year)

                    let tokens: Vec<&str> = line.split_whitespace().collect();
                    if tokens.len() < 7 {
                        continue;
                    }

                    let pid_str = tokens[0];
                    let pid: u32 = match pid_str.parse() {
                        Ok(p) => p,
                        Err(_) => continue,
                    };

                    // Extract command args (everything after PID and date/time)
                    // Date/time is tokens[1] through tokens[5] (5 tokens)
                    // Command starts at token[6]
                    let command_line = tokens[6..].join(" ");

                    // Check if this is a Claude Code process (executable path contains 'claude')
                    if !command_line.contains("/claude") && !command_line.contains("\\claude") {
                        continue;
                    }

                    // Parse command line arguments to extract session info
                    let mut session_id = None;
                    let mut model = "claude-sonnet-4-5".to_string(); // Default model

                    // Extract session ID from --resume flag
                    if let Some(resume_pos) = command_line.find("--resume") {
                        let after_resume = &command_line[resume_pos..];
                        let parts: Vec<&str> = after_resume.split_whitespace().collect();
                        if parts.len() >= 2 {
                            session_id = Some(parts[1].to_string());
                        }
                    }

                    // Extract model from --model flag
                    if let Some(model_pos) = command_line.find("--model") {
                        let after_model = &command_line[model_pos..];
                        let parts: Vec<&str> = after_model.split_whitespace().collect();
                        if parts.len() >= 2 {
                            model = parts[1].to_string();
                        }
                    }

                    // Parse start time from ps output
                    // tokens[1..6] contains the date/time
                    // Format: "Fri Jan 25 21:20:00 2026" (Day Mon Day HH:MM:SS YYYY)
                    let started_at = if tokens.len() >= 7 {
                        // Try to parse the timestamp from ps output
                        let datetime_str = format!("{} {} {} {} {}", tokens[1], tokens[2], tokens[3], tokens[4], tokens[5]);
                        // Parse using a flexible approach - try common formats
                        // For simplicity, we'll use current time as fallback
                        chrono::Utc::now()
                    } else {
                        chrono::Utc::now()
                    };

                    // Create ProcessInfo for discovered process
                    let process_info = ProcessInfo {
                        run_id: pid as i64, // Use PID as run_id for discovered processes
                        process_type: ProcessType::ClaudeSession {
                            session_id: session_id.unwrap_or_else(|| format!("unknown-{}", pid)),
                        },
                        pid,
                        started_at,
                        project_path: "Unknown".to_string(), // Can't easily extract from command line
                        task: "Discovered running process".to_string(),
                        model,
                    };

                    discovered_processes.push(process_info);
                }
            }
        }
        Err(e) => {
            log::error!("Failed to discover system processes: {}", e);
        }
    }

    discovered_processes
}

#[tauri::command]
pub async fn get_all_processes(
    registry: State<'_, ProcessRegistryState>,
) -> Result<Vec<ProcessMonitorInfo>, String> {
    // Get processes from registry (started through web server)
    let registry_processes = registry
        .0
        .get_running_processes()
        .map_err(|e| e.to_string())?;

    // Discover system-wide Claude processes
    let discovered_processes = discover_system_claude_processes();

    // Combine both sources
    let mut all_processes = registry_processes;
    all_processes.extend(discovered_processes);

    let now = chrono::Utc::now();

    let monitor_info: Vec<ProcessMonitorInfo> = all_processes
        .into_iter()
        .map(|p| {
            let duration = now.signed_duration_since(p.started_at);

            let (process_type, session_id, agent_id, agent_name) = match p.process_type {
                ProcessType::ClaudeSession { session_id } => (
                    "claude_session".to_string(),
                    Some(session_id),
                    None,
                    None,
                ),
                ProcessType::AgentRun {
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
    // Get processes from registry (started through web server)
    let registry_processes = registry
        .0
        .get_running_processes()
        .map_err(|e| e.to_string())?;

    // Discover system-wide Claude processes
    let discovered_processes = discover_system_claude_processes();

    // Count discovered Claude sessions (agent runs are only tracked in registry)
    let discovered_claude_sessions = discovered_processes.len();

    let registry_claude_sessions = registry
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
        total_processes: registry_processes.len() + discovered_processes.len(),
        claude_sessions: registry_claude_sessions + discovered_claude_sessions,
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
