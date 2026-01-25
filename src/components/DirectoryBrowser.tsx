import { useState, useEffect } from 'react';
import { Folder, File, Loader2 } from 'lucide-react';
import { browseServerDirectory, type DirItem } from '@/lib/apiAdapter';

interface DirectoryBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
}

export function DirectoryBrowser({ isOpen, onClose, onSelect, initialPath = '/', title = 'Select Project Folder' }: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [items, setItems] = useState<DirItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<string[]>([initialPath]);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(currentPath);
    }
  }, [isOpen, currentPath]);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await browseServerDirectory(path);
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (path: string) => {
    setPathHistory(prev => [...prev, path]);
    setCurrentPath(path);
  };

  const handleGoBack = () => {
    if (pathHistory.length > 1) {
      const newHistory = pathHistory.slice(0, -1);
      setPathHistory(newHistory);
      setCurrentPath(newHistory[newHistory.length - 1]);
    }
  };

  const handleItemClick = (item: DirItem) => {
    if (item.isDir) {
      handleNavigate(item.path);
    }
  };

  const handleSelect = async () => {
    try {
      onSelect(currentPath);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select directory');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-2 p-3 bg-gray-800 border-b border-gray-700">
          <button
            onClick={handleGoBack}
            disabled={pathHistory.length <= 1}
            className="px-2 py-1 text-sm bg-gray-700 text-white rounded disabled:opacity-50"
          >
            ← Back
          </button>
          <input
            type="text"
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
            className="flex-1 px-3 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600"
          />
          <button
            onClick={() => loadDirectory(currentPath)}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Go
          </button>
        </div>

        {/* Directory tree view */}
        <div className="flex-1 overflow-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="text-red-400 text-center py-4">{error}</div>
          ) : (
            <div className="space-y-1">
              {/* Quick access links */}
              <div className="flex gap-2 mb-4 pb-3 border-b border-gray-700">
                {['/', '/home', '/tmp', '/root'].map(path => (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    className={`px-2 py-1 text-xs rounded ${
                      currentPath === path 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {path}
                  </button>
                ))}
              </div>

              {/* Directory contents */}
              {items.map(item => (
                <div
                  key={item.path}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                    item.isDir ? 'hover:bg-gray-800' : 'hover:bg-gray-800 text-gray-400'
                  }`}
                  onClick={() => handleItemClick(item)}
                >
                  {item.isDir ? (
                    <Folder className="w-4 h-4 text-yellow-500" />
                  ) : (
                    <File className="w-4 h-4 text-gray-500" />
                  )}
                  <span className="text-sm text-white truncate">{item.name}</span>
                </div>
              ))}

              {items.length === 0 && (
                <div className="text-gray-500 text-center py-4">Directory is empty</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <span className="text-sm text-gray-400">
            Selected: <span className="text-white">{currentPath}</span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-gray-700 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
