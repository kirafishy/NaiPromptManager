
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { ChainEditor } from './components/ChainEditor';
import { ArtistLibrary } from './components/ArtistLibrary';
import { ArtistAdmin } from './components/ArtistAdmin';
import { InspirationGallery } from './components/InspirationGallery';
import { db } from './services/dbService';
import { api } from './services/api';
import { ChainWithVersion, PromptVersion, PromptChain } from './types';

// Types for navigation state
type ViewState = 'list' | 'edit' | 'library' | 'inspiration' | 'admin';

const App = () => {
  const [view, setView] = useState<ViewState>('list');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [chains, setChains] = useState<ChainWithVersion[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  // Theme State
  const [isDark, setIsDark] = useState(() => localStorage.getItem('nai_theme') === 'dark');

  // Fetch data
  const refreshData = async () => {
    try {
      const data = await db.getAllChains();
      setChains(data);
    } catch (e) {
      console.error("Failed to fetch chains:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check if we have a key saved
    const savedKey = localStorage.getItem('nai_master_key');
    if (savedKey) {
      // Validate the key silently on load
      api.post('/verify-key', { key: savedKey })
        .then(() => {
            setIsLoggedIn(true);
            refreshData();
        })
        .catch(() => {
            localStorage.removeItem('nai_master_key');
            setIsLoggedIn(false);
        });
    }
  }, []);

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
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    
    try {
        await api.post('/verify-key', { key: passwordInput });
        localStorage.setItem('nai_master_key', passwordInput);
        setIsLoggedIn(true);
        refreshData(); // Fetch data after login
    } catch (err) {
        setLoginError('密钥错误 (Invalid Master Key)');
    }
  };

  const handleCreateChain = async (name: string, desc: string) => {
    setLoading(true);
    await db.createChain(name, desc);
    await refreshData();
    setLoading(false);
  };

  const handleUpdateChain = async (id: string, updates: Partial<PromptChain>) => {
      await db.updateChain(id, updates);
      await refreshData();
  };

  const handleSaveVersion = async (data: Partial<PromptVersion>) => {
    if (!selectedId) return;
    setLoading(true);
    await db.saveNewVersion(selectedId, data);
    await refreshData();
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    await db.deleteChain(id);
    await refreshData();
    if (selectedId === id) setView('list');
    setLoading(false);
  };

  const getSelectedChain = () => chains.find(c => c.id === selectedId);

  // --- Render Login Screen (Global Guard) ---
  if (!isLoggedIn) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                <div className="text-center mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-2xl font-bold">
                    N
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">NAI Prompt Manager</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">私有部署 · 版本管理 · 军火库</p>
                </div>
                
                <form onSubmit={handleLogin} className="space-y-4">
                <div>
                    <input 
                    type="password" 
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="请输入 Master Key"
                    autoFocus
                    />
                </div>
                {loginError && <div className="text-red-500 text-sm text-center font-medium animate-pulse">{loginError}</div>}
                <button 
                    type="submit"
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-transform active:scale-[0.98]"
                >
                    进入系统
                </button>
                </form>
                
                <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700/50 flex justify-between items-center text-xs text-gray-400">
                     <span>v0.2.2 Pro</span>
                     <button onClick={toggleTheme} className="hover:text-gray-600 dark:hover:text-gray-200">
                         {isDark ? '切换亮色' : '切换深色'}
                     </button>
                </div>
            </div>
        </div>
    );
  }

  // --- Render Main App ---
  const renderContent = () => {
    if (loading && chains.length === 0 && view === 'list') {
        return <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">加载中...</div>;
    }

    switch (view) {
      case 'list':
        return (
          <ChainList 
            chains={chains} 
            onCreate={handleCreateChain} 
            onSelect={(id) => handleNavigate('edit', id)}
            onDelete={handleDelete}
          />
        );
      case 'edit':
        const editChain = getSelectedChain();
        if (!editChain) return <div>Chain not found</div>;
        return (
          <ChainEditor 
            chain={editChain} 
            onSaveVersion={handleSaveVersion}
            onUpdateChain={handleUpdateChain}
            onBack={() => handleNavigate('list')} 
          />
        );
      case 'library':
          return <ArtistLibrary isDark={isDark} toggleTheme={toggleTheme} />;
      case 'inspiration':
          return <InspirationGallery />;
      case 'admin':
          return <ArtistAdmin />;
      default:
        return <div>Unknown View</div>;
    }
  };

  return (
    <Layout onNavigate={handleNavigate} currentView={view}>
      {renderContent()}
    </Layout>
  );
};

export default App;
