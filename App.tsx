
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { ChainEditor } from './components/ChainEditor';
import { ArtistLibrary } from './components/ArtistLibrary';
import { ArtistAdmin } from './components/ArtistAdmin';
import { InspirationGallery } from './components/InspirationGallery';
import { db } from './services/dbService';
import { PromptChain, User } from './types';

type ViewState = 'list' | 'edit' | 'library' | 'inspiration' | 'admin';

const App = () => {
  const [view, setView] = useState<ViewState>('list');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [chains, setChains] = useState<PromptChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConfigError, setDbConfigError] = useState(false);
  
  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // Theme State
  const [isDark, setIsDark] = useState(() => localStorage.getItem('nai_theme') === 'dark');

  // Check Session on Load
  useEffect(() => {
    db.getMe().then(user => {
        setCurrentUser(user);
        refreshData();
    }).catch(() => {
        setLoading(false);
    });
  }, []);

  const refreshData = async () => {
    setLoading(true);
    try {
      const data = await db.getAllChains();
      setChains(data);
      setDbConfigError(false);
    } catch (e: any) {
      if (e.message && e.message.includes('Database not configured')) {
          setDbConfigError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('nai_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('nai_theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark(!isDark);

  const handleNavigate = (newView: ViewState, id?: string) => {
    setSelectedId(id);
    setView(newView);
    if (newView === 'list' && !loading) {
       refreshData(); 
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
        const res = await db.login(loginUser, loginPass);
        setCurrentUser(res.user);
        refreshData();
    } catch (err: any) {
        setLoginError(err.message || '登录失败');
    }
  };

  const handleLogout = async () => {
      await db.logout();
      setCurrentUser(null);
      setLoginUser(''); setLoginPass('');
  };

  const handleCreateChain = async (name: string, desc: string) => {
    setLoading(true);
    await db.createChain(name, desc);
    await refreshData();
    setLoading(false);
  };

  const handleForkChain = async (chain: PromptChain) => {
      const name = chain.name + ' (Fork)';
      await db.createChain(name, chain.description, chain);
      alert('Fork 成功！已保存到您的列表');
      await refreshData();
      setView('list');
  };

  const handleUpdateChain = async (id: string, updates: Partial<PromptChain>) => {
      await db.updateChain(id, updates);
      await refreshData();
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    await db.deleteChain(id);
    await refreshData();
    if (selectedId === id) setView('list');
    setLoading(false);
  };

  const getSelectedChain = () => chains.find(c => c.id === selectedId);

  // --- Login Screen ---
  if (!currentUser) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                <div className="text-center mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-2xl font-bold">N</div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">NAI Prompt Manager</h2>
                </div>
                
                <form onSubmit={handleLogin} className="space-y-4">
                <div>
                    <input type="text" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white outline-none" placeholder="用户名" autoFocus />
                </div>
                <div>
                    <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white outline-none" placeholder="密码" />
                </div>
                {loginError && <div className="text-red-500 text-sm text-center font-medium animate-pulse">{loginError}</div>}
                <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg">登录</button>
                </form>
                
                <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700/50 flex justify-between items-center text-xs text-gray-400">
                     <span>v0.3.0 RBAC</span>
                     <button onClick={toggleTheme} className="hover:text-gray-600 dark:hover:text-gray-200">{isDark ? '切换亮色' : '切换深色'}</button>
                </div>
            </div>
        </div>
    );
  }

  // --- Database Setup Guide ---
  if (dbConfigError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans dark:text-white">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">数据库未连接</h2>
                <p>请在 Cloudflare 后台绑定 D1 数据库到变量 `DB` 并重新部署。</p>
                <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded">刷新</button>
            </div>
        </div>
      );
  }

  const renderContent = () => {
    switch (view) {
      case 'list':
        return <ChainList chains={chains} onCreate={handleCreateChain} onSelect={(id) => handleNavigate('edit', id)} onDelete={handleDelete} />;
      case 'edit':
        const editChain = getSelectedChain();
        if (!editChain) return <div>Chain not found</div>;
        return <ChainEditor chain={editChain} currentUser={currentUser} onUpdateChain={handleUpdateChain} onBack={() => handleNavigate('list')} onFork={handleForkChain} />;
      case 'library':
          return <ArtistLibrary isDark={isDark} toggleTheme={toggleTheme} />;
      case 'inspiration':
          return <InspirationGallery currentUser={currentUser} />;
      case 'admin':
          return <ArtistAdmin currentUser={currentUser} />;
      default:
        return <div>Unknown View</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen">
       <Layout onNavigate={handleNavigate} currentView={view} isDark={isDark} toggleTheme={toggleTheme}>
         <div className="absolute top-2 right-2 z-50 flex items-center gap-2">
             <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">👤 {currentUser.username} ({currentUser.role})</span>
             <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded shadow-sm">退出</button>
         </div>
         {renderContent()}
       </Layout>
    </div>
  );
};

export default App;
