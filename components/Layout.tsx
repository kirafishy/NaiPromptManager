
import React, { ReactNode } from 'react';
import { User } from '../types';

interface LayoutProps {
  children: ReactNode;
  onNavigate: (view: 'list' | 'edit' | 'library' | 'inspiration' | 'admin' | 'history', id?: string) => void;
  currentView: string;
  isDark: boolean;
  toggleTheme: () => void;
  currentUser?: User | null;
  onLogout?: () => void;
  toast?: { message: string, type: 'success' | 'error' } | null; // Add Toast Prop
}

export const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, isDark, toggleTheme, currentUser, onLogout, toast }) => {
  // 300MB in bytes
  const MAX_STORAGE = 300 * 1024 * 1024;
  
  const getUsagePercentage = () => {
      if (!currentUser || !currentUser.storageUsage) return 0;
      return Math.min(100, (currentUser.storageUsage / MAX_STORAGE) * 100);
  };

  const formatBytes = (bytes?: number) => {
      if (!bytes) return '0 MB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const navItems = [
      { id: 'list', label: '画师串', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /> },
      { id: 'library', label: '军火库', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /> },
      { id: 'inspiration', label: '灵感', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /> },
      { id: 'history', label: '历史', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /> },
      { id: 'admin', label: '我的', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /> },
  ];

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans transition-colors duration-300 relative">
      
      {/* Toast Notification */}
      {toast && (
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in-down w-[90%] md:w-auto text-center">
              <div className={`px-6 py-3 rounded-lg shadow-xl flex items-center justify-center gap-2 ${
                  toast.type === 'error' 
                  ? 'bg-red-500 text-white' 
                  : 'bg-gray-800 dark:bg-white text-white dark:text-gray-900'
              }`}>
                  <span>{toast.type === 'error' ? '❌' : '✅'}</span>
                  <span className="font-medium text-sm">{toast.message}</span>
              </div>
          </div>
      )}

      {/* Desktop Sidebar (Hidden on Mobile) */}
      <aside className="hidden md:flex w-20 md:w-64 flex-shrink-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex-col transition-colors duration-300">
        <div className="p-4 md:p-6 flex items-center justify-center md:justify-start space-x-3 border-b border-gray-200 dark:border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-xl shadow-lg">
            N
          </div>
          <span className="hidden md:block font-bold text-lg tracking-wide text-gray-800 dark:text-gray-200">咒语构建终端</span>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id as any)}
                className={`w-full flex items-center p-3 rounded-lg transition-colors ${
                  currentView === item.id || (item.id === 'list' && currentView === 'edit')
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg>
                <span className="hidden md:block ml-3">{item.label}</span>
              </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex flex-col gap-3">
          {currentUser && currentUser.role !== 'admin' && (
              <div className="hidden md:block mb-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>存储空间</span>
                      <span>{formatBytes(currentUser.storageUsage)} / 300MB</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${getUsagePercentage() > 90 ? 'bg-red-500' : 'bg-indigo-500'}`} 
                        style={{ width: `${getUsagePercentage()}%` }}
                      ></div>
                  </div>
              </div>
          )}

          <button 
                onClick={toggleTheme} 
                className="w-full flex items-center justify-center md:justify-start p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
              <span className="text-xl mr-0 md:mr-2">{isDark ? '🌙' : '☀️'}</span>
              <span className="hidden md:block text-sm font-medium">{isDark ? '切换亮色' : '切换深色'}</span>
          </button>

          {currentUser && (
            <div className="flex items-center justify-between md:justify-start p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50">
                <div className="flex items-center overflow-hidden">
                    <div className="w-6 h-6 rounded bg-indigo-500 text-white flex items-center justify-center text-xs font-bold mr-0 md:mr-2 flex-shrink-0">
                        {currentUser.username[0].toUpperCase()}
                    </div>
                    <span className="hidden md:block text-xs font-medium text-indigo-900 dark:text-indigo-200 truncate">{currentUser.username}</span>
                </div>
                {onLogout && (
                    <button onClick={onLogout} className="text-gray-400 hover:text-red-500 ml-2" title="退出登录">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    </button>
                )}
            </div>
          )}

          <div className="text-xs text-gray-500 dark:text-gray-600 text-center md:text-left">v0.4.1</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col relative bg-white dark:bg-gray-900 transition-colors duration-300 pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 flex justify-around items-center h-16 z-50 pb-safe">
          {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id as any)}
                className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
                  currentView === item.id || (item.id === 'list' && currentView === 'edit')
                  ? 'text-indigo-600 dark:text-indigo-400' 
                  : 'text-gray-500 dark:text-gray-500'
                }`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
          ))}
      </div>
    </div>
  );
};
