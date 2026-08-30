
import React, { useState, useEffect, useRef } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { parseAppPath, pathFor, type AppView } from './app/paths';
import { doneRouteProgress, startRouteProgress } from './app/routeProgress';
import { Layout } from './components/Layout';
import { RouteProgress } from './components/RouteProgress';
import { DbSetupError, Landing } from './components/Landing';
import { ChainList } from './components/ChainList';
import { ChainEditor } from './components/ChainEditor';
import { ArtistLibrary } from './components/ArtistLibrary';
import { ArtistAdmin } from './components/ArtistAdmin';
import { InspirationGallery } from './components/InspirationGallery';
import { GenHistory } from './components/GenHistory';
import { db } from './services/dbService';
import { DEFAULT_NAI_PARAMS } from './services/naiModels';
import { PromptChain, User, Artist, Inspiration, ChainType } from './types';
import { useFeedback } from './components/ui/Feedback';

type ViewState = AppView;

const CACHE_TTL = 60 * 60 * 1000; // 1 Hour Cache

const App = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const target = parseAppPath(location.pathname);
  const [ready, setReady] = useState(target);
  const view = ready.view;
  const selectedId = ready.id;
  const prefetchGen = useRef(0);
  const [chains, setChains] = useState<PromptChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConfigError, setDbConfigError] = useState(false);

  // Playground State
  const [playgroundChain, setPlaygroundChain] = useState<PromptChain | null>(null);

  // Data Cache State
  const [artistsCache, setArtistsCache] = useState<Artist[] | null>(null);
  const [inspirationsCache, setInspirationsCache] = useState<Inspiration[] | null>(null);

  // Cache Timestamps
  const [lastChainFetch, setLastChainFetch] = useState(0);
  const [lastArtistFetch, setLastArtistFetch] = useState(0);
  const [lastInspirationFetch, setLastInspirationFetch] = useState(0);

  // Dirty State for Navigation Guard
  const [isEditorDirty, setIsEditorDirty] = useState(false);

  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [discordEnabled, setDiscordEnabled] = useState(true);

  const { toast, confirm } = useFeedback();
  const notify = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    toast(message, type);
  };

  // Check Session on Load
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const discordError = params.get('discord_error');
    if (discordError) {
      setLoginError(discordError);
      navigate(location.pathname, { replace: true });
    }
    fetch(`/api/meta?_t=${Date.now()}`)
      .then((res) => res.ok ? res.json() : null)
      .then((meta) => {
        if (meta && typeof meta.discordEnabled === 'boolean') setDiscordEnabled(meta.discordEnabled);
      })
      .catch(() => {});
    db.getMe().then(user => {
      setCurrentUser(user);
      refreshData();
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const ensurePlayground = () => {
    setPlaygroundChain((prev) => prev ?? {
      id: 'playground',
      name: '生图实验室',
      description: '临时生图实验，点击保存为串可写入列表',
      userId: currentUser?.id || 'guest',
      basePrompt: '',
      negativePrompt: '',
      modules: [],
      params: { ...DEFAULT_NAI_PARAMS },
      variableValues: { subject: '' },
      type: 'style',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  const refreshData = async (force = false) => {
    // Chains (Always load all chains so we can filter client side and do mutual imports)
    if (!force && chains.length > 0 && Date.now() - lastChainFetch < CACHE_TTL) return;

    if (chains.length === 0) setLoading(true);
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

  const prefetchView = async (next: ViewState) => {
    if (next === 'list' || next === 'characters' || next === 'edit') await refreshData();
    if (next === 'library' || next === 'admin') await loadArtists();
    if (next === 'inspiration') await loadInspirations();
    if (next === 'playground') ensurePlayground();
  };

  const handleNavigate = (newView: ViewState, id?: string) => {
    navigate(pathFor(newView, id));
  };

  const blocker = useBlocker(Boolean(currentUser && isEditorDirty && (view === 'edit' || view === 'playground')));

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    confirm({
      title: '确定要离开吗？',
      description: '您有未保存的更改。',
      confirmLabel: '离开',
      cancelLabel: '继续编辑',
      tone: 'danger',
    }).then((ok) => {
      if (cancelled) return;
      if (ok) {
        setIsEditorDirty(false);
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
    return () => { cancelled = true; };
  }, [blocker.state, confirm]);

  useEffect(() => {
    if (!currentUser) return;
    const gen = ++prefetchGen.current;
    const swap = target.view !== ready.view || target.id !== ready.id;
    if (swap) startRouteProgress();
    prefetchView(target.view).finally(() => {
      if (gen !== prefetchGen.current) return;
      setReady(target);
      if (swap) doneRouteProgress();
    });
  }, [currentUser, target.view, target.id]);

  const handleUpdatePlaygroundChain = async (id: string, updates: Partial<PromptChain>) => {
    setPlaygroundChain(prev => prev ? { ...prev, ...updates } : null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await db.login(loginUser, loginPass);
      setCurrentUser(res.user);
      // 切换角色后丢弃旧列表，避免前一个账号的私人串短暂残留
      setChains([]);
      setLastChainFetch(0);
      // Force refresh chains to apply guest_hidden/private filters based on new role
      await refreshData(true);
      // Guest should not stay in admin/profile view
      if (res.user.role === 'guest' && (target.view === 'admin' || target.view === 'edit')) {
        navigate(pathFor('list'), { replace: true });
      }
    } catch (err: any) {
      setLoginError(err.message || '登录失败');
    }
  };

  const handleLogout = async () => {
    await db.logout();
    setCurrentUser(null);
    setLoginUser(''); setLoginPass('');
    // Clear all cache to prevent stale data after role switch
    setChains([]);
    setLastChainFetch(0);
    setInspirationsCache(null);
    // Reset view to list to prevent guest from staying in admin view
    navigate(pathFor('list'), { replace: true });
  };

  const handleCreateChain = async (name: string, desc: string, type: ChainType) => {
    setLoading(true);
    const newId = await db.createChain(name, desc, undefined, type);
    await refreshData(true);
    setLoading(false);
    handleNavigate('edit', newId);
  };

  const handleForkChain = async (chain: PromptChain, targetType?: ChainType) => {
    const finalType = targetType || chain.type;
    const fromPlayground = chain.id === 'playground';
    const name = fromPlayground ? chain.name : `${chain.name} (Fork)`;
    await db.createChain(name, chain.description, chain, finalType); // Persist type on fork
    notify(fromPlayground ? '已保存为串' : 'Fork 成功！已保存到您的列表');
    await refreshData(true);
    // Return to appropriate list based on type
    navigate(pathFor(finalType === 'character' ? 'characters' : 'list'));
  };

  const handleUpdateChain = async (id: string, updates: Partial<PromptChain>) => {
    await db.updateChain(id, updates);
    await refreshData(true);
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    await db.deleteChain(id);
    await refreshData(true);
    // Stay on current list view
    setLoading(false);
  };

  const getSelectedChain = () => chains.find(c => c.id === selectedId);

  if (!currentUser) {
    return (
      <>
      <RouteProgress />
      <Landing
        loginUser={loginUser}
        loginPass={loginPass}
        loginError={loginError}
        discordEnabled={discordEnabled}
        onLoginUserChange={setLoginUser}
        onLoginPassChange={setLoginPass}
        onSubmit={handleLogin}
      />
      </>
    );
  }

  if (dbConfigError) {
    return <DbSetupError />;
  }

  const openChainType = (next: ChainType) => {
    handleNavigate(next === 'character' ? 'characters' : 'list');
  };

  const renderChainList = (type: ChainType, isGuest: boolean) => (
    <ChainList
      chains={chains}
      type={type}
      onTypeChange={openChainType}
      onCreate={handleCreateChain}
      onSelect={(id) => handleNavigate('edit', id)}
      onDelete={handleDelete}
      onRefresh={() => refreshData(true)}
      isLoading={loading}
      notify={notify}
      isGuest={isGuest}
    />
  );

  const renderContent = () => {
    switch (view) {
      case 'list':
      case 'characters':
        return renderChainList(view === 'characters' ? 'character' : 'style', currentUser.role === 'guest');
      case 'edit':
        const editChain = getSelectedChain();
        if (!editChain) return <div>Chain not found</div>;
        return <ChainEditor
          key={editChain.id}
          chain={editChain}
          allChains={chains}
          currentUser={currentUser}
          onUpdateChain={handleUpdateChain}
          onBack={() => handleNavigate(editChain.type === 'character' ? 'characters' : 'list')}
          onFork={handleForkChain}
          setIsDirty={setIsEditorDirty}
          notify={notify}
        />;
      case 'library':
        return <ArtistLibrary
          artistsData={artistsCache}
          onRefresh={() => loadArtists(true)}
          notify={notify}
          currentUser={currentUser}
        />;
      case 'inspiration':
        return <InspirationGallery
          currentUser={currentUser}
          inspirationsData={inspirationsCache}
          onRefresh={() => loadInspirations(true)}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground')}
        />;
      case 'admin':
        return <ArtistAdmin
          currentUser={currentUser}
          artistsData={artistsCache}
          onRefreshArtists={() => loadArtists(true)}
        />;
      case 'history':
        return <GenHistory currentUser={currentUser} notify={notify} onNavigateToPlayground={() => handleNavigate('playground')} onRefreshInspiration={() => loadInspirations(true)} />;
      case 'playground':
        if (!playgroundChain) return <div>Loading...</div>;
        return <ChainEditor
          key={playgroundChain.id}
          chain={playgroundChain}
          allChains={chains}
          currentUser={currentUser}
          onUpdateChain={handleUpdatePlaygroundChain}
          onBack={() => handleNavigate('list')}
          onFork={handleForkChain}
          setIsDirty={() => { }}
          notify={notify}
        />;
      default:
        return <div>Unknown View</div>;
    }
  };

  return (
    <>
      <RouteProgress />
      <Layout
        currentView={view}
        currentUser={currentUser}
        onLogout={handleLogout}
      >
        {renderContent()}
      </Layout>
    </>
  );
};

export default App;
