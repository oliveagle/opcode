import React, { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { TabPersistenceService } from '@/services/tabPersistence';
import { SessionPersistenceService } from '@/services/sessionPersistence';
import { api } from '@/lib/api';

export interface Tab {
  id: string;
  type: 'chat' | 'agent' | 'agents' | 'projects' | 'usage' | 'mcp' | 'process-monitor' | 'settings' | 'claude-md' | 'claude-file' | 'agent-execution' | 'create-agent' | 'import-agent';
  title: string;
  sessionId?: string;  // for chat tabs
  sessionData?: any; // for chat tabs - stores full session object
  agentRunId?: string; // for agent tabs
  agentData?: any; // for agent-execution tabs
  claudeFileId?: string; // for claude-file tabs
  initialProjectPath?: string; // for chat tabs
  projectPath?: string; // for agent-execution tabs
  status: 'active' | 'idle' | 'running' | 'complete' | 'error';
  hasUnsavedChanges: boolean;
  order: number;
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
  needsSessionRefresh?: boolean; // Flag to indicate tab needs to fetch session data on activation
  sessionDataAvailable?: boolean; // Session exists but data needs to be loaded on demand
}

interface TabContextType {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, 'id' | 'order' | 'createdAt' | 'updatedAt'>) => string;
  removeTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  setActiveTab: (id: string) => void;
  reorderTabs: (startIndex: number, endIndex: number) => void;
  getTabById: (id: string) => Tab | undefined;
  closeAllTabs: () => void;
  getTabsByType: (type: 'chat' | 'agent') => Tab[];
  refreshTabSession: (tabId: string) => Promise<boolean>;
  validateAndCleanupTabs: () => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

// const STORAGE_KEY = 'opcode_tabs'; // No longer needed - persistence disabled
const MAX_TABS = 20;

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const isInitialized = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Load tabs from storage on mount
  useEffect(() => {
    const loadTabs = async () => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    // Migrate from old format if needed
    TabPersistenceService.migrateFromOldFormat();

    // Try to load saved tabs
    const { tabs: savedTabs, activeTabId: savedActiveTabId } = TabPersistenceService.loadTabs();

    if (savedTabs.length > 0) {
      // For chat tabs, restore session data with API fallback
      const restoredTabs = await Promise.all(savedTabs.map(async (tab) => {
        if (tab.type === 'chat' && tab.sessionId) {
          // First try localStorage
          const sessionData = SessionPersistenceService.loadSession(tab.sessionId);
          if (sessionData) {
            const session = SessionPersistenceService.createSessionFromRestoreData(sessionData);
            return {
              ...tab,
              sessionData: session,
              initialProjectPath: sessionData.projectPath
            };
          }

          // Fallback: Try to restore from API by finding the session in projects
          try {
            const projects = await api.listProjects();
            for (const project of projects) {
              if (project.sessions?.includes(tab.sessionId)) {
                // Found the project, get session details
                const projectSessions = await api.getProjectSessions(project.id);
                const matchingSession = projectSessions.find((s: any) => s.id === tab.sessionId);
                if (matchingSession) {
                  return {
                    ...tab,
                    sessionData: matchingSession,
                    initialProjectPath: project.path
                  };
                }
                break;
              }
            }
          } catch (error) {
            console.warn(`[TabContext] Failed to restore session ${tab.sessionId} from API:`, error);
          }

          // If we still couldn't restore, mark the tab as invalid
          // It has a sessionId but no valid session data
          console.warn(`[TabContext] Could not restore session ${tab.sessionId}, tab will be marked as needing refresh`);
          return {
            ...tab,
            needsSessionRefresh: true // Flag to indicate this tab needs to fetch session data on activation
          };
        }
        return tab;
      }));

      // Filter out completely invalid tabs (no session data and can't be recovered)
      const validTabs = restoredTabs.filter(tab => {
        if (tab.type === 'chat' && tab.sessionId) {
          // Chat tabs need either sessionData or the ability to refresh
          if (!tab.sessionData && !tab.needsSessionRefresh) {
            return false;
          }
        }
        return true;
      });

      // Reorder and set state
      const orderedTabs = validTabs
        .sort((a, b) => a.order - b.order)
        .map((tab, index) => ({ ...tab, order: index }));

      // Ensure active tab is valid
      let validActiveTabId = savedActiveTabId;
      if (validActiveTabId && !orderedTabs.some(t => t.id === validActiveTabId)) {
        validActiveTabId = orderedTabs.length > 0 ? orderedTabs[0].id : null;
      }

      setTabs(orderedTabs);
      setActiveTabId(validActiveTabId);
    } else {
      // Create default projects tab if no saved tabs
      const defaultTab: Tab = {
        id: generateTabId(),
        type: 'projects',
        title: 'Projects',
        status: 'idle',
        hasUnsavedChanges: false,
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      setTabs([defaultTab]);
      setActiveTabId(defaultTab.id);
    }
    };

    loadTabs();
  }, []);

  // Save tabs to localStorage with debounce for rapid changes
  useEffect(() => {
    // Don't save if not initialized
    if (!isInitialized.current) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce saving to avoid excessive writes during rapid changes
    saveTimeoutRef.current = setTimeout(() => {
      TabPersistenceService.saveTabs(tabs, activeTabId);
    }, 500); // Wait 500ms after last change before saving

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tabs, activeTabId]);

  // Helper function to save tabs immediately
  const saveTabsImmediately = useCallback(() => {
    if (isInitialized.current && tabs.length > 0) {
      TabPersistenceService.saveTabs(tabs, activeTabId);
    }
  }, [tabs, activeTabId]);

  // Save tabs immediately when window is about to close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isInitialized.current && tabs.length > 0) {
        // Use sendBeacon for more reliable saving during page unload
        const data = JSON.stringify({
          tabs: tabs.map(t => ({
            id: t.id,
            type: t.type,
            title: t.title,
            sessionId: t.sessionId,
            sessionDataAvailable: t.sessionDataAvailable,
            agentRunId: t.agentRunId,
            claudeFileId: t.claudeFileId,
            initialProjectPath: t.initialProjectPath,
            projectPath: t.projectPath,
            status: t.status,
            hasUnsavedChanges: false,
            order: t.order,
            icon: t.icon,
            createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
            updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt
          })),
          activeTabId
        });

        // Use sendBeacon which is more reliable than synchronous XHR
        if (navigator.sendBeacon) {
          const blob = new Blob([data], { type: 'application/json' });
          navigator.sendBeacon('/api/save-tabs', blob);
        }

        // Fallback to synchronous save
        TabPersistenceService.saveTabs(tabs, activeTabId);
      }
    };

    // Also save on visibilitychange (when user switches tabs or minimizes browser)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveTabsImmediately();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Save one final time when component unmounts
      saveTabsImmediately();
    };
  }, [tabs, activeTabId, saveTabsImmediately]);

  const generateTabId = () => {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const addTab = useCallback((tabData: Omit<Tab, 'id' | 'order' | 'createdAt' | 'updatedAt'>): string => {
    if (tabs.length >= MAX_TABS) {
      throw new Error(`Maximum number of tabs (${MAX_TABS}) reached`);
    }

    const newTab: Tab = {
      ...tabData,
      id: generateTabId(),
      order: tabs.length,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    setTabs(prevTabs => [...prevTabs, newTab]);
    setActiveTabId(newTab.id);

    // Save immediately for critical operations
    saveTabsImmediately();

    return newTab.id;
  }, [tabs.length, saveTabsImmediately]);

  const removeTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      const filteredTabs = prevTabs.filter(tab => tab.id !== id);

      // Reorder remaining tabs
      const reorderedTabs = filteredTabs.map((tab, index) => ({
        ...tab,
        order: index
      }));

      // Update active tab if necessary
      if (activeTabId === id && reorderedTabs.length > 0) {
        const removedTabIndex = prevTabs.findIndex(tab => tab.id === id);
        const newActiveIndex = Math.min(removedTabIndex, reorderedTabs.length - 1);
        setActiveTabId(reorderedTabs[newActiveIndex].id);
      } else if (reorderedTabs.length === 0) {
        setActiveTabId(null);
      }

      return reorderedTabs;
    });

    // Save immediately for critical operations
    saveTabsImmediately();
  }, [activeTabId, saveTabsImmediately]);

  const updateTab = useCallback((id: string, updates: Partial<Tab>) => {
    setTabs(prevTabs => 
      prevTabs.map(tab => 
        tab.id === id 
          ? { ...tab, ...updates, updatedAt: new Date() }
          : tab
      )
    );
  }, []);

  const setActiveTab = useCallback((id: string) => {
    if (tabs.find(tab => tab.id === id)) {
      setActiveTabId(id);
    }
  }, [tabs]);

  const reorderTabs = useCallback((startIndex: number, endIndex: number) => {
    setTabs(prevTabs => {
      const newTabs = [...prevTabs];
      const [removed] = newTabs.splice(startIndex, 1);
      newTabs.splice(endIndex, 0, removed);
      
      // Update order property
      return newTabs.map((tab, index) => ({
        ...tab,
        order: index
      }));
    });
  }, []);

  const getTabById = useCallback((id: string): Tab | undefined => {
    return tabs.find(tab => tab.id === id);
  }, [tabs]);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    TabPersistenceService.clearTabs();
  }, []);

  const getTabsByType = useCallback((type: 'chat' | 'agent'): Tab[] => {
    return tabs.filter(tab => tab.type === type);
  }, [tabs]);

  // Refresh session data for a tab that needs it
  const refreshTabSession = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || tab.type !== 'chat' || !tab.sessionId) {
      return false;
    }

    try {
      // Try to find the session through projects
      const projects = await api.listProjects();
      for (const project of projects) {
        if (project.sessions?.includes(tab.sessionId!)) {
          const projectSessions = await api.getProjectSessions(project.id);
          const matchingSession = projectSessions.find((s: any) => s.id === tab.sessionId);
          if (matchingSession) {
            updateTab(tabId, {
              sessionData: matchingSession,
              initialProjectPath: project.path,
              needsSessionRefresh: false
            });
            return true;
          }
          break;
        }
      }

      // If we couldn't find it, try loading session history to verify it exists
      if (tab.initialProjectPath) {
        try {
          // Extract projectId from the session or use the path as fallback
          const projectId = tab.sessionData?.project_id || tab.sessionId;
          const history = await api.loadSessionHistory(tab.sessionId, projectId);
          if (history && history.length > 0) {
            // Session exists, mark it as needing refresh when user interacts
            updateTab(tabId, {
              needsSessionRefresh: false,
              sessionDataAvailable: true // Session exists but we need to load its full data
            });
            return true;
          }
        } catch {
          // Session might not exist anymore
          console.warn(`[TabContext] Session ${tab.sessionId} not found or inaccessible`);
        }
      }

      return false;
    } catch (error) {
      console.error(`[TabContext] Failed to refresh session for tab ${tabId}:`, error);
      return false;
    }
  }, [tabs, updateTab]);

  // Validate and cleanup invalid tabs
  const validateAndCleanupTabs = useCallback(() => {
    setTabs(prevTabs => {
      const validTabs: Tab[] = [];

      for (const tab of prevTabs) {
        // Check if this is an invalid chat tab
        if (tab.type === 'chat' && tab.sessionId) {
          // Chat tabs need session data to be useful
          if (!tab.sessionData) {
            // If it needs refresh and we're validating, remove it
            // This typically happens when the session was never properly saved
            console.warn(`[TabContext] Removing invalid chat tab without session data: ${tab.id}`);
            continue;
          }
        }

        validTabs.push(tab);
      }

      // If we removed any tabs, update active tab if needed
      if (validTabs.length !== prevTabs.length) {
        const hadActiveTab = prevTabs.some(t => t.id === activeTabId);
        if (hadActiveTab && !validTabs.some(t => t.id === activeTabId)) {
          // Active tab was removed, switch to first available
          if (validTabs.length > 0) {
            setActiveTabId(validTabs[0].id);
          } else {
            setActiveTabId(null);
          }
        }
      }

      return validTabs;
    });
  }, [activeTabId]);

  const value: TabContextType = {
    tabs,
    activeTabId,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    reorderTabs,
    getTabById,
    closeAllTabs,
    getTabsByType,
    refreshTabSession,
    validateAndCleanupTabs
  };

  return (
    <TabContext.Provider value={value}>
      {children}
    </TabContext.Provider>
  );
};

export const useTabContext = () => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabContext must be used within a TabProvider');
  }
  return context;
};
