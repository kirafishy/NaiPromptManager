
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { ChainEditor } from './components/ChainEditor';
import { ArtistLibrary } from './components/ArtistLibrary';
import { ArtistAdmin } from './components/ArtistAdmin';
import { InspirationGallery } from './components/InspirationGallery';
import { GenHistory } from './components/GenHistory';
import { db } from './services/dbService';
import { PromptChain, User, Artist, Inspiration } from './types';

type ViewState = 'list' | 'edit' | 'library' | 'inspiration' | 'admin' | 'history';

const CACHE_TTL = 60 * 60 * 1000; // 1 Hour Cache

const App = () => {
  const [view, setView] = useState<ViewState>('list');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [chains, setChains] = useState<PromptChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConfigError, setDbConfigError] = useState(false);
  
  // Data Cache State
  const [artistsCache, setArtistsCache] = useState<Artist[] | null>(null);
  const [inspirationsCache, setInspirationsCache] = useState<Inspiration[] | null>(null);
  const [usersCache, setUsersCache] = useState<User[] | null>(null);

  // Cache Timestamps
  const [lastChainFetch, setLastChainFetch] = useState(0);
  const [lastArtistFetch, setLastArtistFetch] = useState(0);
  const [lastInspirationFetch, setLastInspirationFetch] = useState(0);
  const [lastUserFetch, setLastUserFetch] = useState(0);

  // Dirty State for Navigation Guard
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  
  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // Theme State
  const [isDark, setIsDark] = useState(() => localStorage.getItem('nai_theme') === 'dark');

  // Toast State
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 3000);
  };

  // Check Session on Load
  useEffect(() => {
    db.getMe().then(user => {
        setCurrentUser(user);
        refreshData();
    }).catch(() => {
        setLoading(false);
    });
  }, []);

  const refreshData = async (force = false) => {
    // Chains
    if (!force && chains.length > 0 && Date.now() - lastChainFetch < CACHE_TTL) return;

    setLoading(true);
    try {
      const data = await db.getAllChains();
      setChains(data);
      setLastChainFetch(Date.now());
      setDbConfigError(false);
    } catch (e: any) {
      if (e.message && e.message.includes('Database not configured')) {
          setDbConfigError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadArtists = async (force = false) => {
      if (!force && artistsCache && Date.now() - lastArtistFetch < CACHE_TTL) return;
      const data = await db.getAllArtists();
      setArtistsCache(data.sort((a, b) => a.name.localeCompare(b.name)));
      setLastArtistFetch(Date.now());
  };

  const loadInspirations = async (force = false) => {
      if (!force && inspirationsCache && Date.now() - lastInspirationFetch < CACHE_TTL) return;
      const data = await db.getAllInspirations();
      setInspirationsCache(data);
      setLastInspirationFetch(Date.now());
  };

  const loadUsers = async (force = false) => {
      if (!currentUser || currentUser.role !== 'admin') return;
      if (!force && usersCache && Date.now() - lastUserFetch < CACHE_TTL) return;
      const data = await db.getUsers();
      setUsersCache(data);
      setLastUserFetch(Date.now());
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
    if (isEditorDirty) {
        if (!confirm('您有未保存的更改，确定要离开吗？')) {
            return;
        }
        // User confirmed, reset dirty state
        setIsEditorDirty(false);
    }

    setSelectedId(id);
    setView(newView);
    
    // Auto-load data based on view, respecting cache
    if (newView === 'list') refreshData();
    if (newView === 'library') loadArtists();
    if (newView === 'inspiration') loadInspirations();
    if (newView === 'admin' && currentUser?.role === 'admin') {
        loadArtists();
        loadUsers();
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
      // Clear sensitive cache
      setUsersCache(null);
      setInspirationsCache(null);
  };

  const handleCreateChain = async (name: string, desc: string) => {
    setLoading(true);
    await db.createChain(name, desc);
    await refreshData(true);
    setLoading(false);
  };

  const handleForkChain = async (chain: PromptChain) => {
      const name = chain.name + ' (Fork)';
      await db.createChain(name, chain.description, chain);
      notify('Fork 成功！已保存到您的列表');
      await refreshData(true);
      setView('list');
  };

  const handleUpdateChain = async (id: string, updates: Partial<PromptChain>) => {
      await db.updateChain(id, updates);
      await refreshData(true);
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    await db.deleteChain(id);
    await refreshData(true);
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
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">NAI 咒语构建终端</h2>
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
                     <span>v0.4.1</span>
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
        return <ChainList 
                    chains={chains} 
                    onCreate={handleCreateChain} 
                    onSelect={(id) => handleNavigate('edit', id)} 
                    onDelete={handleDelete}
                    onRefresh={() => refreshData(true)}
                    isLoading={loading}
                    notify={notify}
               />;
      case 'edit':
        const editChain = getSelectedChain();
        if (!editChain) return <div>Chain not found</div>;
        return <ChainEditor 
                chain={editChain} 
                currentUser={currentUser} 
                onUpdateChain={handleUpdateChain} 
                onBack={() => handleNavigate('list')} 
                onFork={handleForkChain} 
                setIsDirty={setIsEditorDirty}
                notify={notify}
               />;
      case 'library':
          return <ArtistLibrary 
                    isDark={isDark} 
                    toggleTheme={toggleTheme} 
                    artistsData={artistsCache} 
                    onRefresh={() => loadArtists(true)} 
                    notify={notify}
                 />;
      case 'inspiration':
          return <InspirationGallery 
                    currentUser={currentUser} 
                    inspirationsData={inspirationsCache} 
                    onRefresh={() => loadInspirations(true)} 
                    notify={notify}
                 />;
      case 'admin':
          return <ArtistAdmin 
                    currentUser={currentUser} 
                    artistsData={artistsCache}
                    usersData={usersCache}
                    onRefreshArtists={() => loadArtists(true)}
                    onRefreshUsers={() => loadUsers(true)}
                 />;
      case 'history':
          return <GenHistory currentUser={currentUser} notify={notify} />;
      default:
        return <div>Unknown View</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen">
       <Layout 
         onNavigate={handleNavigate} 
         currentView={view} 
         isDark={isDark} 
         toggleTheme={toggleTheme}
         currentUser={currentUser}
         onLogout={handleLogout}
         toast={toast}
       >
         {renderContent()}
       </Layout>
    </div>
  );
};

export default App;
