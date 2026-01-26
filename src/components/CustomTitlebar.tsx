import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Minus, Square, X, Bot, BarChart3, FileText, Network, Info, MoreVertical, Activity, Copy, Wrench, GitBranch } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TooltipProvider, TooltipSimple } from '@/components/ui/tooltip-modern';
import { ProcessMonitorPopover } from '@/components/ProcessMonitorPopover';
import { api } from '@/lib/api';
import { cn } from "@/lib/utils";
import { networkStatusManager, type NetworkStatus } from "@/lib/apiAdapter";

interface CustomTitlebarProps {
  onSettingsClick?: () => void;
  onAgentsClick?: () => void;
  onUsageClick?: () => void;
  onClaudeClick?: () => void;
  onMCPClick?: () => void;
  onInfoClick?: () => void;
  onCopyClick?: () => void;
  onCheckpointSettingsClick?: () => void;
  onTimelineClick?: () => void;
}

export const CustomTitlebar: React.FC<CustomTitlebarProps> = ({
  onSettingsClick,
  onAgentsClick,
  onUsageClick,
  onClaudeClick,
  onMCPClick,
  onInfoClick,
  onCopyClick,
  onCheckpointSettingsClick,
  onTimelineClick
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showProcessMonitor, setShowProcessMonitor] = useState(false);
  const [runningProcessCount, setRunningProcessCount] = useState(0);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('disconnected');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      // Close process monitor popover when clicking outside
      const target = event.target as Node;
      const popover = document.querySelector('[data-process-monitor-popover="true"]');
      if (showProcessMonitor && popover && !popover.contains(target)) {
        setShowProcessMonitor(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProcessMonitor]);

  // Subscribe to network status
  useEffect(() => {
    const unsubscribe = networkStatusManager.subscribe((status) => {
      setNetworkStatus(status);
    });

    // Start periodic health checks to detect server availability
    networkStatusManager.startHealthCheck();

    return () => {
      unsubscribe();
      networkStatusManager.stopHealthCheck();
    };
  }, []);

  // Fetch process count periodically
  useEffect(() => {
    const fetchProcessCount = async () => {
      try {
        const stats = await api.getProcessStats();
        setRunningProcessCount(stats.total_processes);
      } catch (err) {
        console.error('Failed to fetch process count:', err);
      }
    };

    fetchProcessCount();
    const interval = setInterval(fetchProcessCount, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow();
      await window.minimize();
      console.log('Window minimized successfully');
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  };

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow();
      const isMaximized = await window.isMaximized();
      if (isMaximized) {
        await window.unmaximize();
        console.log('Window unmaximized successfully');
      } else {
        await window.maximize();
        console.log('Window maximized successfully');
      }
    } catch (error) {
      console.error('Failed to maximize/unmaximize window:', error);
    }
  };

  const handleClose = async () => {
    try {
      const window = getCurrentWindow();
      await window.close();
      console.log('Window closed successfully');
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  };

  return (
    <TooltipProvider>
    <div 
      className="relative z-[200] h-11 bg-background/95 backdrop-blur-sm flex items-center justify-between select-none border-b border-border/50 tauri-drag"
      data-tauri-drag-region
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Left side - macOS Traffic Light buttons */}
      <div className="flex items-center space-x-2 pl-5">
        <div className="flex items-center space-x-2">
          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className="group relative w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-all duration-200 flex items-center justify-center tauri-no-drag"
            title="Close"
          >
            {isHovered && (
              <X size={8} className="text-red-900 opacity-60 group-hover:opacity-100" />
            )}
          </button>

          {/* Minimize button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMinimize();
            }}
            className="group relative w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-all duration-200 flex items-center justify-center tauri-no-drag"
            title="Minimize"
          >
            {isHovered && (
              <Minus size={8} className="text-yellow-900 opacity-60 group-hover:opacity-100" />
            )}
          </button>

          {/* Maximize button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMaximize();
            }}
            className="group relative w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-all duration-200 flex items-center justify-center tauri-no-drag"
            title="Maximize"
          >
            {isHovered && (
              <Square size={6} className="text-green-900 opacity-60 group-hover:opacity-100" />
            )}
          </button>
        </div>
      </div>

      {/* Center - Title (hidden) */}
      {/* <div 
        className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        data-tauri-drag-region
      >
        <span className="text-sm font-medium text-foreground/80">{title}</span>
      </div> */}

      {/* Right side - Navigation icons with improved spacing */}
      <div className="flex items-center pr-5 gap-3 tauri-no-drag">
        {/* Primary actions group */}
        <div className="flex items-center gap-1">
          {onAgentsClick && (
            <TooltipSimple content="Agents" side="bottom">
              <motion.button
                onClick={onAgentsClick}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
              >
                <Bot size={16} />
              </motion.button>
            </TooltipSimple>
          )}
          
          {onUsageClick && (
            <TooltipSimple content="Usage Dashboard" side="bottom">
              <motion.button
                onClick={onUsageClick}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
              >
                <BarChart3 size={16} />
              </motion.button>
            </TooltipSimple>
          )}

          {/* Process Monitor Button - always shown next to stats */}
          <TooltipSimple content="Process Monitor" side="bottom">
            <motion.button
              onClick={() => setShowProcessMonitor(!showProcessMonitor)}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className={`p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag relative ${
                showProcessMonitor ? 'bg-accent text-accent-foreground' : ''
              }`}
            >
              <Activity size={16} />
              {runningProcessCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {runningProcessCount}
                </span>
              )}
            </motion.button>
          </TooltipSimple>

          {/* Network Status Indicator */}
          {(() => {
            const statusConfig: Record<NetworkStatus, { color: string; bgColor: string; dotColor: string; label: string }> = {
              connected: { color: 'text-green-500', bgColor: 'bg-green-500/20', dotColor: 'bg-green-500', label: 'Online' },
              connecting: { color: 'text-yellow-500', bgColor: 'bg-yellow-500/20', dotColor: 'bg-yellow-500', label: 'Connecting...' },
              error: { color: 'text-red-500', bgColor: 'bg-red-500/20', dotColor: 'bg-red-500', label: 'Error' },
              disconnected: { color: 'text-muted-foreground', bgColor: 'bg-muted/20', dotColor: 'bg-muted-foreground', label: 'Offline' },
            };
            const config = statusConfig[networkStatus];

            return (
              <TooltipSimple content={config.label} side="bottom">
                <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors", config.bgColor)}>
                  <div className="relative flex items-center justify-center">
                    <span className={cn("absolute w-2 h-2 rounded-full", config.dotColor)} />
                    {networkStatus === 'connected' && (
                      <span className={cn("absolute w-2 h-2 rounded-full animate-ping opacity-75", config.dotColor)} style={{ animationDuration: '2s' }} />
                    )}
                  </div>
                  <span className={cn("text-xs font-medium", config.color)}>
                    {networkStatus === 'connected' ? 'Online' : networkStatus === 'connecting' ? 'Connecting' : 'Offline'}
                  </span>
                </div>
              </TooltipSimple>
            );
          })()}
        </div>

        {/* Visual separator */}
        <div className="w-px h-5 bg-border/50" />

        {/* Secondary actions group */}
        <div className="flex items-center gap-1">
          {onSettingsClick && (
            <TooltipSimple content="Settings" side="bottom">
              <motion.button
                onClick={onSettingsClick}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
              >
                <Settings size={16} />
              </motion.button>
            </TooltipSimple>
          )}

          {/* Dropdown menu for additional options */}
          <div className="relative" ref={dropdownRef}>
            <TooltipSimple content="More options" side="bottom">
              <motion.button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-1"
              >
                <MoreVertical size={16} />
              </motion.button>
            </TooltipSimple>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-popover border border-border rounded-lg shadow-lg z-[250]">
                <div className="py-1">
                  {onTimelineClick && (
                    <button
                      onClick={() => {
                        onTimelineClick();
                        setIsDropdownOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3"
                    >
                      <GitBranch size={14} />
                      <span>Session Timeline</span>
                    </button>
                  )}

                  {onCopyClick && (
                    <button
                      onClick={() => {
                        onCopyClick();
                        setIsDropdownOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3"
                    >
                      <Copy size={14} />
                      <span>Copy Conversation</span>
                    </button>
                  )}

                  {onCheckpointSettingsClick && (
                    <button
                      onClick={() => {
                        onCheckpointSettingsClick();
                        setIsDropdownOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3"
                    >
                      <Wrench size={14} />
                      <span>Checkpoint Settings</span>
                    </button>
                  )}

                  <div className="border-t border-border my-1" />

                  {onClaudeClick && (
                    <button
                      onClick={() => {
                        onClaudeClick();
                        setIsDropdownOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3"
                    >
                      <FileText size={14} />
                      <span>CLAUDE.md</span>
                    </button>
                  )}

                  {onMCPClick && (
                    <button
                      onClick={() => {
                        onMCPClick();
                        setIsDropdownOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3"
                    >
                      <Network size={14} />
                      <span>MCP Servers</span>
                    </button>
                  )}

                  {onInfoClick && (
                    <button
                      onClick={() => {
                        onInfoClick();
                        setIsDropdownOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3"
                    >
                      <Info size={14} />
                      <span>About</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Process Monitor Popover */}
    <AnimatePresence>
      {showProcessMonitor && (
        <div data-process-monitor-popover="true">
          <ProcessMonitorPopover onClose={() => setShowProcessMonitor(false)} />
        </div>
      )}
    </AnimatePresence>
    </TooltipProvider>
  );
};
