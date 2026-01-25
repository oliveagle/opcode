import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Skull,
  Trash2,
  RefreshCw,
  Clock,
  Cpu,
  Folder,
  Terminal,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Bot,
} from "lucide-react";
import { api, type ProcessMonitorInfo, type ProcessMonitorStats } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ProcessMonitor() {
  const [processes, setProcesses] = useState<ProcessMonitorInfo[]>([]);
  const [stats, setStats] = useState<ProcessMonitorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killingProcess, setKillingProcess] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const loadProcesses = async () => {
    try {
      setLoading(true);
      setError(null);
      const [processesData, statsData] = await Promise.all([
        api.getAllProcesses(),
        api.getProcessStats(),
      ]);
      setProcesses(processesData || []);
      setStats(statsData || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load processes");
      console.error("Failed to load processes:", err);
    } finally {
      setLoading(false);
    }
  };

  const killProcess = async (runId: number) => {
    try {
      setKillingProcess(runId);
      await api.killProcessByRunId(runId);
      await loadProcesses();
    } catch (err) {
      console.error("Failed to kill process:", err);
      setError(err instanceof Error ? err.message : "Failed to kill process");
    } finally {
      setKillingProcess(null);
    }
  };

  const killAllProcesses = async () => {
    try {
      await api.killAllProcesses();
      await loadProcesses();
      setConfirmDialog({ ...confirmDialog, open: false });
    } catch (err) {
      console.error("Failed to kill all processes:", err);
      setError(err instanceof Error ? err.message : "Failed to kill all processes");
    }
  };

  const killClaudeSessions = async () => {
    try {
      await api.killAllClaudeSessions();
      await loadProcesses();
      setConfirmDialog({ ...confirmDialog, open: false });
    } catch (err) {
      console.error("Failed to kill Claude sessions:", err);
      setError(err instanceof Error ? err.message : "Failed to kill Claude sessions");
    }
  };

  const killAgentRuns = async () => {
    try {
      await api.killAllAgentRuns();
      await loadProcesses();
      setConfirmDialog({ ...confirmDialog, open: false });
    } catch (err) {
      console.error("Failed to kill agent runs:", err);
      setError(err instanceof Error ? err.message : "Failed to kill agent runs");
    }
  };

  useEffect(() => {
    loadProcesses();

    if (autoRefresh) {
      const interval = setInterval(loadProcesses, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString();
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-3xl font-bold">Process Monitor</h1>
            <p className="text-sm text-muted-foreground">
              Monitor and manage Claude Code processes and sessions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? "animate-spin" : ""}`} />
            Auto-refresh
          </Button>
          <Button variant="outline" size="sm" onClick={loadProcesses}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-500"
        >
          <AlertTriangle className="w-5 h-5" />
          <span>{error}</span>
        </motion.div>
      )}

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Cpu className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">Total Processes</p>
                <p className="text-2xl font-bold">{stats.total_processes}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Terminal className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">Claude Sessions</p>
                <p className="text-2xl font-bold">{stats.claude_sessions}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Bot className="w-8 h-8 text-purple-500" />
              <div>
                <p className="text-sm text-muted-foreground">Agent Runs</p>
                <p className="text-2xl font-bold">{stats.agent_runs}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Global Actions */}
      {stats && stats.total_processes > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skull className="w-5 h-5 text-red-500" />
              <span className="font-semibold">Danger Zone</span>
            </div>
            <div className="flex gap-2">
              {stats.claude_sessions > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Terminal className="w-4 h-4 mr-2" />
                      Kill All Claude Sessions
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Kill all Claude sessions?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will terminate {stats.claude_sessions} running Claude session(s).
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={killClaudeSessions}>
                        Kill All Sessions
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {stats.agent_runs > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Bot className="w-4 h-4 mr-2" />
                      Kill All Agent Runs
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Kill all agent runs?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will terminate {stats.agent_runs} running agent(s).
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={killAgentRuns}>
                        Kill All Agents
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Kill All Processes
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Kill all processes?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will terminate all {stats.total_processes} running process(es).
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={killAllProcesses}>
                      Kill All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </Card>
      )}

      {/* Process List */}
      <Card className="flex-1 overflow-hidden">
        <div className="h-full overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : processes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <CheckCircle className="w-16 h-16 mb-4 text-green-500" />
              <p className="text-lg font-semibold">No running processes</p>
              <p className="text-sm">All systems are idle</p>
            </div>
          ) : (
            <div className="divide-y">
              {processes.map((process) => (
                <motion.div
                  key={process.run_id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      {/* Header */}
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            process.process_type === "claude_session"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {process.process_type === "claude_session" ? (
                            <>
                              <Terminal className="w-3 h-3 mr-1" />
                              Claude Session
                            </>
                          ) : (
                            <>
                              <Bot className="w-3 h-3 mr-1" />
                              Agent Run
                            </>
                          )}
                        </Badge>
                        <Badge variant="outline">PID: {process.pid}</Badge>
                        <Badge variant="outline">ID: {process.run_id}</Badge>
                      </div>

                      {/* Task Description */}
                      <div className="flex items-start gap-2">
                        <Terminal className="w-4 h-4 mt-1 text-muted-foreground" />
                        <p className="text-sm flex-1">{process.task || "No task description"}</p>
                      </div>

                      {/* Details */}
                      <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Folder className="w-4 h-4" />
                          <span className="truncate" title={process.project_path}>
                            {process.project_path}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          <span>
                            {formatTime(process.started_at)} ({formatDuration(process.duration_seconds)})
                          </span>
                        </div>
                        {process.agent_name && (
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4" />
                            <span>{process.agent_name}</span>
                          </div>
                        )}
                        {process.session_id && (
                          <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4" />
                            <span className="font-mono text-xs">
                              {process.session_id.slice(0, 8)}...
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4" />
                          <span>{process.model}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => killProcess(process.run_id)}
                              disabled={killingProcess === process.run_id}
                            >
                              {killingProcess === process.run_id ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-500" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Kill process</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
