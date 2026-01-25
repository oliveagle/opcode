import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  XCircle,
  RefreshCw,
  Clock,
  Cpu,
  Folder,
  Terminal,
  Bot,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { api, type ProcessMonitorInfo, type ProcessMonitorStats } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ProcessMonitorPopoverProps {
  /**
   * Callback when popover should close
   */
  onClose: () => void;
}

/**
 * Compact process monitor popover for quick access from titlebar
 * Displays running Claude Code processes with ability to kill them
 */
export function ProcessMonitorPopover({ onClose }: ProcessMonitorPopoverProps) {
  const [processes, setProcesses] = useState<ProcessMonitorInfo[]>([]);
  // Close handler is used for potential close button in the future
  const handleClose = () => {
    onClose();
  };
  const [stats, setStats] = useState<ProcessMonitorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killingProcess, setKillingProcess] = useState<number | null>(null);

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

  useEffect(() => {
    loadProcesses();
    const interval = setInterval(loadProcesses, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="fixed right-4 top-14 z-[300] w-[480px] max-h-[70vh] bg-background border border-border rounded-lg shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          <h2 className="font-semibold">Process Monitor</h2>
          {stats && (
            <Badge variant="secondary" className="ml-2">
              {stats.total_processes} running
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadProcesses}
            disabled={loading}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-8 w-8 p-0"
          >
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
        {loading && processes.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-4 flex items-center gap-2 text-red-500">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        ) : processes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <CheckCircle className="w-10 h-10 mb-2 text-green-500" />
            <p className="text-sm">No running processes</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            <AnimatePresence>
              {processes.map((process) => (
                <motion.div
                  key={process.run_id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Type badge and PID */}
                      <div className="flex items-center gap-2 mb-2">
                        <Badge
                          variant={
                            process.process_type === "claude_session"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {process.process_type === "claude_session" ? (
                            <>
                              <Terminal className="w-3 h-3 mr-1" />
                              Session
                            </>
                          ) : (
                            <>
                              <Bot className="w-3 h-3 mr-1" />
                              Agent
                            </>
                          )}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">
                          PID: {process.pid}
                        </span>
                      </div>

                      {/* Task description */}
                      <p className="text-sm font-medium truncate mb-2" title={process.task}>
                        {process.task || "No task"}
                      </p>

                      {/* Details grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1 truncate" title={process.project_path}>
                          <Folder className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{process.project_path.split('/').pop()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          <span>{formatDuration(process.duration_seconds)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Cpu className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{process.model}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Terminal className="w-3 h-3 flex-shrink-0" />
                          <span className="font-mono">{formatTime(process.started_at)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Kill button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => killProcess(process.run_id)}
                      disabled={killingProcess === process.run_id}
                      className="h-8 w-8 p-0 flex-shrink-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      title="Kill process"
                    >
                      {killingProcess === process.run_id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer with stats */}
      {stats && stats.total_processes > 0 && (
        <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3 text-green-500" />
              {stats.claude_sessions} sessions
            </span>
            <span className="flex items-center gap-1">
              <Bot className="w-3 h-3 text-purple-500" />
              {stats.agent_runs} agents
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
