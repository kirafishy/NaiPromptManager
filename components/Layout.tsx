
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
}

export const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, isDark, toggleTheme, currentUser, onLogout }) => {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans transition-colors duration-300">
      {/* Sidebar */}
      <aside className="w-20 md:w-64 flex-shrink-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col transition-colors duration-300">
        <div className="p-4 md:p-6 flex items-center justify-center md:justify-start space-x-3 border-b border-gray-200 dark:border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-xl shadow-lg">
            N
          </div>
          <span className="hidden md:block font-bold text-lg tracking-wide text-gray-800 dark:text-gray-200">NAI 助手</span>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => onNavigate('list')}
            className={`w-full flex items-center p-3 rounded-lg transition-colors ${
              currentView === 'list' || currentView === 'edit' 
              ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold' 
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span className="hidden md:block ml-3">我的 Prompt 链</span>
          </button>
          
          <button
            onClick={() => onNavigate('history')}
            className={`w-full flex items-center p-3 rounded-lg transition-colors ${
              currentView === 'history' 
              ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold' 
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="hidden md:block ml-3">生图历史</span>
          </button>
          
          <button
            onClick={() => onNavigate('library')}
            className={`w-full flex items-center p-3 rounded-lg transition-colors ${
              currentView === 'library' 
              ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold' 
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="hidden md:block ml-3">画师军火库</span>
          </button>

          <button
            onClick={() => onNavigate('inspiration')}
            className={`w-full flex items-center p-3 rounded-lg transition-colors ${
              currentView === 'inspiration' 
              ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold' 
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            <span className="hidden md:block ml-3">灵感图库</span>
          </button>

          <button
            onClick={() => onNavigate('admin')}
            className={`w-full flex items-center p-3 rounded-lg transition-colors ${
              currentView === 'admin' 
              ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold' 
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="hidden md:block ml-3">后台管理</span>
          </button>
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex flex-col gap-3">
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

          <div className="text-xs text-gray-500 dark:text-gray-600 text-center md:text-left">v0.3.2 History</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col relative bg-white dark:bg-gray-900 transition-colors duration-300">
        {children}
      </main>
    </div>
  );
};
