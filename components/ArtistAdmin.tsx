
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/dbService';
import { Artist, User, UserRole, UsageStats, AccessLog, DailyStat } from '../types';
import { ROLE_POLICY } from '../config/rolePolicy';
import {
  USER_LIST_DEFAULT_PAGE_SIZE,
  USER_LIST_ROLE_FILTERS,
  userListPageButtons,
} from '../config/userListQuery';
import { AboutPage } from './AboutPage';
import { AppearanceSettings } from './AppearanceSettings';
import { ApiEndpointSettings } from './ApiEndpointSettings';
import { ApiKeyFields, Button, Empty, Field, IconButton, IconChart, IconCrown, IconDiscord, IconInbox, IconPackage, IconPalette, IconPencil, IconTrash, IconUser, Input, Panel, Seg, Select, Switch } from './ui';
import { useFeedback } from './ui/Feedback';
import { cx } from './ui/cx';

type ArtistWeightSyntax = 'numeric' | 'bracket';

const ARTIST_WEIGHT_SYNTAX_KEY = 'naipm.artistLibrary.weightSyntax';
const ARTIST_WEIGHT_SYNTAX_CHANGE_EVENT = 'naipm-artist-weight-syntax-change';

interface ExtendedArtistAdminProps {
    currentUser: User;
    artistsData: Artist[] | null;
    onRefreshArtists: () => Promise<void>;
}

export const ArtistAdmin: React.FC<ExtendedArtistAdminProps> = ({
    currentUser, artistsData, onRefreshArtists,
}) => {
  const { toast, confirm } = useFeedback();
  // 使用统一的角色策略
  const isAdmin = currentUser.role === 'admin';
  const isVip = currentUser.role === 'vip';
  const canManageArtists = ROLE_POLICY.canManageArtists(currentUser.role);
  const [activeTab, setActiveTab] = useState<'artist' | 'users' | 'profile' | 'stats' | 'about'>('profile');
  
  // Artist State (Managed via props now, filtered here if needed)
  const artists = artistsData || [];

  const [users, setUsers] = useState<User[]>([]);
  const [userSearchInput, setUserSearchInput] = useState('');
  const [userListParams, setUserListParams] = useState<{ q: string; role: UserRole | ''; page: number }>({
      q: '',
      role: '',
      page: 1,
  });
  const [userPagination, setUserPagination] = useState({
      page: 1,
      pageSize: USER_LIST_DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 0,
  });
  const [usersReady, setUsersReady] = useState(false);

  const [artistName, setArtistName] = useState('');
  const [artistImg, setArtistImg] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // 配额编辑状态
  const [editingQuotaUserId, setEditingQuotaUserId] = useState<string | null>(null);
  const [newQuotaMB, setNewQuotaMB] = useState<string>('');



  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importLog, setImportLog] = useState<string[]>([]);

  // Profile State
  const [myNewPassword, setMyNewPassword] = useState('');

  // 图片压缩偏好（与"历史压缩 / 自动 JPG 保存"共享）
  // 存储：LocalStorage `naipm.compaction.*` 命名空间
  const [jpgQuality, setJpgQuality] = useState<number>(() => {
      const raw = localStorage.getItem('naipm.compaction.quality');
      const v = raw ? parseFloat(raw) : 0.85;
      return isNaN(v) ? 0.85 : v;
  });
  const [autoJpg, setAutoJpg] = useState<boolean>(
      () => localStorage.getItem('naipm.compaction.autoJpg') === 'true'
  );
  const handleQualityChange = (v: number) => {
      const clamped = Math.min(1, Math.max(0.01, v));
      setJpgQuality(clamped);
      localStorage.setItem('naipm.compaction.quality', clamped.toFixed(2));
  };
  const handleAutoJpgChange = (v: boolean) => {
      setAutoJpg(v);
      localStorage.setItem('naipm.compaction.autoJpg', v ? 'true' : 'false');
  };

  // 军火库偏好：控制复制画师 tag 时使用数字权重或括号权重
  const [artistWeightSyntax, setArtistWeightSyntax] = useState<ArtistWeightSyntax>(() => {
      const raw = localStorage.getItem(ARTIST_WEIGHT_SYNTAX_KEY);
      return raw === 'bracket' ? 'bracket' : 'numeric';
  });
  const handleArtistWeightSyntaxChange = (syntax: ArtistWeightSyntax) => {
      setArtistWeightSyntax(syntax);
      localStorage.setItem(ARTIST_WEIGHT_SYNTAX_KEY, syntax);
      window.dispatchEvent(new Event(ARTIST_WEIGHT_SYNTAX_CHANGE_EVENT));
  };

  // Usage Stats State
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Storage calculation helpers - 使用统一的角色策略
  const formatBytes = (bytes?: number) => {
      if (!bytes) return '0 MB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const loadUsers = useCallback(async () => {
      if (!isAdmin) return;
      setIsLoading(true);
      try {
          const res = await db.getUsers({
              page: userListParams.page,
              pageSize: USER_LIST_DEFAULT_PAGE_SIZE,
              q: userListParams.q || undefined,
              role: userListParams.role || undefined,
          });
          setUsers(res.data);
          setUserPagination(res.pagination);
          if (res.pagination.totalPages > 0 && userListParams.page > res.pagination.totalPages) {
              setUserListParams(prev => ({ ...prev, page: res.pagination.totalPages }));
          }
      } catch {
          toast('加载用户列表失败', 'error');
      } finally {
          setIsLoading(false);
          setUsersReady(true);
      }
  }, [isAdmin, userListParams]);

  useEffect(() => {
      const t = window.setTimeout(() => {
          const q = userSearchInput.trim();
          setUserListParams(prev => (prev.q === q ? prev : { ...prev, q, page: 1 }));
      }, 300);
      return () => window.clearTimeout(t);
  }, [userSearchInput]);

  useEffect(() => {
      if (isAdmin && activeTab === 'users') {
          void loadUsers();
      }
  }, [isAdmin, activeTab, loadUsers]);

  const handleRefresh = async () => {
      setIsLoading(true);
      if (activeTab === 'artist') await onRefreshArtists();
      if (activeTab === 'users') await loadUsers();
      setIsLoading(false);
  };

  const handleArtistSave = async () => {
    if (!artistName.trim() || !artistImg.trim()) return;
    setIsLoading(true);
    const id = editingId || crypto.randomUUID();
    
    // Find existing artist to preserve benchmarks if editing
    const existing = artists.find(a => a.id === id);
    const payload = {
        id,
        name: artistName.trim(),
        imageUrl: artistImg,
        previewUrl: existing?.previewUrl,
        benchmarks: existing?.benchmarks
    };

    await db.saveArtist(payload);
    
    setArtistName(''); 
    setArtistImg(''); 
    setEditingId(null);
    await onRefreshArtists();
    setIsLoading(false);
  };

  const handleEditArtist = (artist: Artist) => {
      setEditingId(artist.id);
      setArtistName(artist.name);
      setArtistImg(artist.imageUrl);
  };

  const handleCancelEdit = () => {
      setEditingId(null);
      setArtistName('');
      setArtistImg('');
  };

  const handleArtistDelete = async (id: string) => {
      const ok = await confirm({ title: '确定删除该画师吗？', confirmLabel: '删除', tone: 'danger' });
      if (!ok) return;
      setIsLoading(true);
      await db.deleteArtist(id);
      await onRefreshArtists();
      setIsLoading(false);
  };

  const handleCreateUser = async () => {
      if(!newUsername || !newPassword) return;
      setIsLoading(true);
      try {
        await db.createUser(newUsername, newPassword);
        setNewUsername(''); setNewPassword('');
        await loadUsers();
        toast('用户创建成功', 'success');
      } catch(e) { toast('创建失败：用户名可能已存在', 'error'); }
      setIsLoading(false);
  };

  const handleDeleteUser = async (id: string) => {
      const ok = await confirm({ title: '删除这个用户？', description: '此操作无法撤销。', confirmLabel: '删除', tone: 'danger' });
      if (!ok) return;
      setIsLoading(true);
      await db.deleteUser(id);
      await loadUsers();
      setIsLoading(false);
  };

  const handleUpdateQuota = async (userId: string) => {
      const mb = parseFloat(newQuotaMB);
      if (isNaN(mb) || mb < 0) {
          toast('请输入有效的配额数值（非负数）', 'warning');
          return;
      }
      
      // 验证配额上限（100GB）
      const MAX_QUOTA_MB = 100 * 1024; // 100GB in MB
      if (mb > MAX_QUOTA_MB) {
          toast(`配额值超出上限，最大允许 ${MAX_QUOTA_MB} MB (100GB)`, 'warning');
          return;
      }
      
      const bytes = Math.round(mb * 1024 * 1024);
      setIsLoading(true);
      try {
          await db.updateUserQuota(userId, bytes);
          await loadUsers();
          setEditingQuotaUserId(null);
          setNewQuotaMB('');
          toast('配额更新成功', 'success');
      } catch(e: any) {
          // 提供更具体的错误信息
          let errorMessage = '更新失败';
          if (e.message) {
              if (e.message.includes('User not found')) {
                  errorMessage = '用户不存在，请刷新页面重试';
              } else if (e.message.includes('Invalid maxStorage')) {
                  errorMessage = '配额值无效，请检查输入';
              } else if (e.message.includes('Forbidden')) {
                  errorMessage = '权限不足，请确认管理员权限';
              } else if (e.message.includes('network') || e.message.includes('fetch')) {
                  errorMessage = '网络错误，请检查网络连接';
              } else {
                  errorMessage = `更新失败: ${e.message}`;
              }
          }
          toast(errorMessage, 'error');
          console.error('配额更新失败:', e);
      }
      setIsLoading(false);
  };

  // Fetch Usage Stats when Stats Tab is active
  useEffect(() => {
      if (isAdmin && activeTab === 'stats') {
          setStatsLoading(true);
          db.getUsageStats()
              .then(setUsageStats)
              .catch(console.error)
              .finally(() => setStatsLoading(false));
      }
  }, [activeTab, isAdmin]);

  // 清理旧日志
  const handleClearLogs = async () => {
      const ok = await confirm({ title: '清理 30 天前的登录日志？', confirmLabel: '清理', tone: 'danger' });
      if (!ok) return;
      setClearingLogs(true);
      try {
          await db.clearOldLogs();
          const newStats = await db.getUsageStats();
          setUsageStats(newStats);
          toast('旧日志已清理', 'success');
      } catch (e) {
          toast('清理失败', 'error');
      }
      setClearingLogs(false);
  };

  // 格式化日期时间（包含时间）
  const formatDateTime = (timestamp: number | string) => {
      if (!timestamp || isNaN(Number(timestamp))) return '未知';
      return new Date(Number(timestamp)).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
      });
  };

  // 格式化日期（仅日期）
  const formatDate = (timestamp: number | string) => {
      if (!timestamp || isNaN(Number(timestamp))) return '未知';
      return new Date(Number(timestamp)).toLocaleDateString('zh-CN');
  };

  const handleChangePassword = async () => {
      if(!myNewPassword) return;
      await db.updatePassword(myNewPassword);
      setMyNewPassword('');
      toast('密码修改成功', 'success');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => setArtistImg(reader.result as string);
          reader.readAsDataURL(file);
      }
  };

  // --- GitHub Import Logic ---
  const handleBatchDemote = async () => {
      const ok = await confirm({
          title: '批量改回游客？',
          description: '将普通用户中 15 天未登录、且配额使用为 0 的账号改回游客权限组，并套用游客默认配额。当前登录账号不会被改动。',
          confirmLabel: '改回游客',
          tone: 'danger',
      });
      if (!ok) return;
      setIsLoading(true);
      try {
          const { count } = await db.demoteStaleUsers();
          await loadUsers();
          toast(count ? `已将 ${count} 名用户改回游客` : '没有符合条件的用户', count ? 'success' : 'info');
      } catch (e) {
          toast('批量更新失败', 'error');
      }
      setIsLoading(false);
  };

  const handleGithubImport = async () => {
      const ok = await confirm({
          title: '从 GitHub 导入画师？',
          description: '将从 twoearcat/nai-artists 仓库抓取所有图片并导入数据库。过程可能较慢，请勿关闭页面。',
          confirmLabel: '开始导入',
      });
      if (!ok) return;
      
      setIsImporting(true);
      setImportProgress(0);
      setImportLog(['Fetching file list from GitHub API...']);

      try {
          // 1. Fetch File List from GitHub API
          const repoApi = "https://api.github.com/repos/twoearcat/nai-artists/contents/images";
          const res = await fetch(repoApi);
          if (!res.ok) throw new Error('GitHub API Limit or Network Error');
          
          const files = await res.json();
          const imageFiles = Array.isArray(files) ? files.filter((f: any) => f.name.match(/\.(png|jpg|jpeg)$/i)) : [];
          
          if (imageFiles.length === 0) {
              setImportLog(prev => [...prev, 'No images found in repository.']);
              setIsImporting(false);
              return;
          }

          setImportLog(prev => [...prev, `Found ${imageFiles.length} images. Starting import...`]);
          
          // 2. Process Loop
          let successCount = 0;
          for (let i = 0; i < imageFiles.length; i++) {
              const file = imageFiles[i];
              const rawUrl = file.download_url; // API provides direct download link
              // Name: Remove extension and underscores
              const name = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
              
              try {
                  // Call Backend to Fetch & Save
                  await db.importArtistFromGithub(name, rawUrl);
                  successCount++;
                  // Update log every 5 items to reduce render spam
                  if (i % 5 === 0) setImportLog(prev => [`[${i + 1}/${imageFiles.length}] Imported: ${name}`, ...prev.slice(0, 10)]);
              } catch (err: any) {
                  setImportLog(prev => [`[ERROR] Failed: ${name} - ${err.message}`, ...prev]);
              }

              setImportProgress(Math.round(((i + 1) / imageFiles.length) * 100));
          }

          setImportLog(prev => [`Done! Successfully imported ${successCount} artists.`, ...prev]);
          await onRefreshArtists();

      } catch (e: any) {
          setImportLog(prev => [`FATAL ERROR: ${e.message}`, ...prev]);
      } finally {
          setIsImporting(false);
      }
  };

  const tabOptions = [
      { value: 'profile' as const, label: '偏好设置' },
      ...((isAdmin || isVip) ? [{ value: 'artist' as const, label: '画师管理' }] : []),
      ...(isAdmin ? [
          { value: 'users' as const, label: '用户管理' },
          { value: 'stats' as const, label: '使用统计' },
      ] : []),
      { value: 'about' as const, label: '关于' },
  ];

  return (
    <div className="page-scroll settings-scroll">
      <div className="settings-page">
        <header className="board-head settings-head">
            <div className="board-head-top">
                <div>
                    <h1>设置</h1>
                </div>
                {canManageArtists && (activeTab === 'artist' || activeTab === 'users') && (
                    <IconButton label="刷新列表" onClick={handleRefresh}>
                        <span className={isLoading ? 'is-spin' : undefined}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </span>
                    </IconButton>
                )}
            </div>
            <Seg<'profile' | 'about' | 'artist' | 'users' | 'stats'>
                className="settings-tabs"
                aria-label="设置分区"
                value={activeTab}
                onChange={setActiveTab}
                options={tabOptions}
            />
        </header>

        {activeTab === 'artist' && canManageArtists && (
            <div className="settings-stack wide">
                <Panel title="快速导入">
                    {isImporting ? (
                        <>
                            <div className="usage-bar" style={{ height: 8, marginBottom: 8 }}>
                                <i style={{ width: `${importProgress}%` }} />
                            </div>
                            <div className="import-log">
                                {importLog.map((l, i) => <div key={i}>{l}</div>)}
                            </div>
                        </>
                    ) : (
                        <Button variant="secondary" onClick={handleGithubImport}>
                            一键从 GitHub 导入 (twoearcat/nai-artists)
                        </Button>
                    )}
                </Panel>

                <Panel title={editingId ? '编辑画师' : '添加画师'}>
                    <div className="create-form">
                        <Field label="画师名称">
                            <Input value={artistName} onChange={e => setArtistName(e.target.value)} placeholder="画师名称" />
                        </Field>
                        <Field label="图片">
                            <div className="pref-row">
                                <input type="file" onChange={handleFileUpload} className="hidden" id="art-up" />
                                <label htmlFor="art-up" className="btn btn-secondary btn-sm">上传</label>
                                <Input value={artistImg} onChange={e => setArtistImg(e.target.value)} placeholder="图片 URL/Base64" />
                            </div>
                        </Field>
                        <div className="sheet-foot">
                            {editingId && <Button variant="ghost" onClick={handleCancelEdit}>取消</Button>}
                            <Button onClick={handleArtistSave}>{editingId ? '保存修改' : '添加'}</Button>
                        </div>
                    </div>
                </Panel>

                <div className="artist-admin-grid">
                    {artists.map(a => (
                        <div key={a.id} className="artist-admin-item surface">
                            <div className="card-extra artist-admin-name">
                                <img src={a.imageUrl} alt="" loading="lazy" />
                                <strong title={a.name}>{a.name}</strong>
                            </div>
                            <div className="card-extra artist-admin-actions">
                                <IconButton size="sm" label="编辑" onClick={() => handleEditArtist(a)}>
                                    <IconPencil />
                                </IconButton>
                                <IconButton size="sm" danger label="删除" onClick={() => handleArtistDelete(a.id)}>
                                    <IconTrash />
                                </IconButton>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {activeTab === 'users' && isAdmin && (
            <div className="settings-stack wide">
                 <Panel title="创建用户">
                    <div className="pref-row">
                        <Input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="用户名" />
                        <Input value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="密码" />
                        <Button className="pref-action" onClick={handleCreateUser}>创建</Button>
                    </div>
                </Panel>

                <Panel title="批量改回游客">
                    <p className="hint">
                        普通用户、15 天内未登录、且配额使用为 0 的账号。此操作作用于全库，不受下方搜索与筛选影响。
                    </p>
                    <div className="sheet-foot">
                        <Button onClick={handleBatchDemote} disabled={isLoading}>批量改回游客</Button>
                    </div>
                </Panel>

                <div className="user-list-tools">
                    <div className="search">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" /></svg>
                        <Input
                            type="search"
                            value={userSearchInput}
                            onChange={e => setUserSearchInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                const q = userSearchInput.trim();
                                setUserListParams(prev => (prev.q === q ? prev : { ...prev, q, page: 1 }));
                            }}
                            placeholder="搜索用户名 / Discord"
                            aria-label="搜索用户"
                        />
                    </div>
                    <Select
                        aria-label="按权限组筛选"
                        value={userListParams.role}
                        onChange={e => {
                            const role = e.target.value as UserRole | '';
                            setUserListParams(prev => ({ ...prev, role, page: 1 }));
                        }}
                    >
                        {USER_LIST_ROLE_FILTERS.map(opt => (
                            <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
                        ))}
                    </Select>
                    <span className="user-list-meta">
                        {!usersReady
                            ? '加载中...'
                            : userPagination.total > 0
                                ? `共 ${userPagination.total} 人${userPagination.totalPages > 1 ? ` · ${userPagination.page}/${userPagination.totalPages} 页` : ''}`
                                : '没有符合条件的用户'}
                    </span>
                </div>

                <div className="page-scroll" style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>用户名</th>
                                <th>角色</th>
                                <th>注册时间</th>
                                <th>最后登录</th>
                                <th>存储配额</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => {
                                const usagePercent = u.maxStorage ? Math.min(100, ((u.storageUsage || 0) / u.maxStorage) * 100) : 0;
                                return (
                                <tr key={u.id} className={u.role === 'vip' ? 'vip-row' : undefined}>
                                    <td>
                                        <span className={u.role === 'vip' ? 'vip-username' : undefined}>{u.username}</span>
                                        {u.role === 'vip' && <span className="vip-crown" title="VIP"><IconCrown /></span>}
                                    </td>
                                    <td>
                                        <Select
                                            aria-label={`${u.username} 的角色`}
                                            value={u.role}
                                            onChange={async (e) => {
                                                const newRole = e.target.value;
                                                try {
                                                    await db.updateUserRole(u.id, newRole, newRole === 'guest');
                                                    await loadUsers();
                                                    toast(`已将 ${u.username} 设为${ROLE_POLICY.getRoleDisplayName(newRole as User['role'])}`, 'success');
                                                } catch (err) {
                                                    toast('角色更新失败', 'error');
                                                }
                                            }}
                                            className="role-select"
                                            disabled={u.id === currentUser.id}
                                        >
                                            <option value="guest">{ROLE_POLICY.getRoleDisplayName('guest')}</option>
                                            <option value="user">{ROLE_POLICY.getRoleDisplayName('user')}</option>
                                            <option value="vip">{ROLE_POLICY.getRoleDisplayName('vip')}</option>
                                            <option value="admin">{ROLE_POLICY.getRoleDisplayName('admin')}</option>
                                        </Select>
                                    </td>
                                    <td className="hint">{formatDate(u.createdAt)}</td>
                                    <td className="hint">{formatDateTime(u.lastLogin)}</td>
                                    <td>
                                        {u.role === 'guest' ? (
                                            <div className="hint">无配额</div>
                                        ) : ROLE_POLICY.isUnlimitedStorage(u.role) ? (
                                            <div className="hint">
                                                <strong>无限制</strong>
                                                <div>管理员不受存储配额限制</div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="hint">
                                                    {formatBytes(u.storageUsage)} / {formatBytes(u.maxStorage || ROLE_POLICY.getDefaultQuota(u.role) || 0)}
                                                </div>
                                                <div className={cx('quota-bar', usagePercent > 90 ? 'hot' : usagePercent > 70 ? 'warn' : 'ok')}>
                                                    <i style={{ width: `${usagePercent}%` }} />
                                                </div>
                                                {editingQuotaUserId === u.id ? (
                                                    <div className="pref-row" style={{ marginTop: 6 }}>
                                                        <Input
                                                            type="number"
                                                            value={newQuotaMB}
                                                            onChange={e => setNewQuotaMB(e.target.value)}
                                                            placeholder="MB"
                                                            style={{ width: 88 }}
                                                        />
                                                        <Button size="sm" onClick={() => handleUpdateQuota(u.id)}>保存</Button>
                                                        <Button size="sm" variant="ghost" onClick={() => { setEditingQuotaUserId(null); setNewQuotaMB(''); }}>取消</Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => { setEditingQuotaUserId(u.id); setNewQuotaMB(String(Math.round((u.maxStorage || 0) / (1024 * 1024)))); }}
                                                    >
                                                        修改配额
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </td>
                                    <td>
                                        {u.id !== currentUser.id && u.role !== 'guest' && (
                                            <Button size="sm" variant="danger" onClick={() => handleDeleteUser(u.id)}>删除</Button>
                                        )}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {users.length === 0 && usersReady && !isLoading && (
                        <Empty title="没有符合条件的用户" />
                    )}
                </div>
                {userPagination.totalPages > 1 && (
                    <div className="user-pager hist-pager surface">
                        <div className="hist-pages">
                            <Button size="sm" variant="ghost" onClick={() => setUserListParams(prev => ({ ...prev, page: 1 }))} disabled={userListParams.page === 1 || isLoading}>首页</Button>
                            <Button size="sm" variant="ghost" onClick={() => setUserListParams(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))} disabled={userListParams.page === 1 || isLoading}>上一页</Button>
                            {userListPageButtons(userListParams.page, userPagination.totalPages).map(page => (
                                <Button
                                    key={page}
                                    size="sm"
                                    variant={page === userListParams.page ? 'primary' : 'ghost'}
                                    onClick={() => setUserListParams(prev => ({ ...prev, page }))}
                                >
                                    {page}
                                </Button>
                            ))}
                            <Button size="sm" variant="ghost" onClick={() => setUserListParams(prev => ({ ...prev, page: Math.min(userPagination.totalPages, prev.page + 1) }))} disabled={userListParams.page === userPagination.totalPages || isLoading}>下一页</Button>
                            <Button size="sm" variant="ghost" onClick={() => setUserListParams(prev => ({ ...prev, page: userPagination.totalPages }))} disabled={userListParams.page === userPagination.totalPages || isLoading}>末页</Button>
                        </div>
                    </div>
                )}
            </div>
        )}

        {activeTab === 'stats' && isAdmin && (
            <div className="settings-stack wide">
                {statsLoading ? (
                    <Empty title="加载中..." />
                ) : usageStats ? (
                    <>
                        <div className="stat-grid">
                            {(() => {
                                const latest = usageStats.dailyStats[0];
                                const prev = usageStats.dailyStats[1];
                                const todayLogins = latest ? latest.userLogins + latest.guestLogins : null;
                                const prevLogins = prev ? prev.userLogins + prev.guestLogins : null;
                                const delta = todayLogins != null && prevLogins != null ? todayLogins - prevLogins : null;
                                const deltaLabel = delta == null ? null : `${delta > 0 ? '+' : ''}${delta} 较昨日`;
                                return (
                                    <>
                                        <div className="stat-card surface">
                                            <div className="stat-card-ico"><IconUser /></div>
                                            <strong>{usageStats.storage.userCount}</strong>
                                            <span>注册用户</span>
                                            {deltaLabel ? <i className={cx('stat-delta', delta! > 0 && 'up', delta! < 0 && 'down')}>{deltaLabel}</i> : todayLogins != null ? <i className="stat-delta">今日登录 {todayLogins}</i> : null}
                                        </div>
                                        <div className="stat-card surface">
                                            <div className="stat-card-ico"><IconInbox /></div>
                                            <strong>{usageStats.storage.chainsCount}</strong>
                                            <span>画师串/角色串</span>
                                        </div>
                                        <div className="stat-card surface">
                                            <div className="stat-card-ico"><IconPalette /></div>
                                            <strong>{usageStats.storage.inspirationsCount}</strong>
                                            <span>灵感图</span>
                                        </div>
                                        <div className="stat-card surface">
                                            <div className="stat-card-ico"><IconChart /></div>
                                            <strong>{usageStats.storage.artistsCount}</strong>
                                            <span>画师库</span>
                                        </div>
                                        <div className="stat-card surface">
                                            <div className="stat-card-ico"><IconPackage /></div>
                                            <strong>{formatBytes(usageStats.storage.totalUserStorage)}</strong>
                                            <span>R2 存储</span>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        <Panel title="近期登录统计">
                            {usageStats.dailyStats.length > 0 ? (
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>日期</th>
                                            <th>游客登录</th>
                                            <th>用户登录</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {usageStats.dailyStats.slice(0, 7).map((stat) => (
                                            <tr key={stat.date}>
                                                <td>{stat.date}</td>
                                                <td><span className="role-pill role-guest">{stat.guestLogins}</span></td>
                                                <td><span className="role-pill role-user">{stat.userLogins}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <Empty title="暂无统计数据" />
                            )}
                        </Panel>

                        <Panel
                            title="登录日志（最近 50 条）"
                            meta={(
                                <Button size="sm" variant="danger" onClick={handleClearLogs} disabled={clearingLogs}>
                                    {clearingLogs ? '清理中...' : '清理 30 天前日志'}
                                </Button>
                            )}
                        >
                            {usageStats.recentLogs.length > 0 ? (
                                <div className="page-scroll" style={{ maxHeight: 360 }}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>时间</th>
                                                <th>用户</th>
                                                <th>角色</th>
                                                <th>IP</th>
                                                <th>操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {usageStats.recentLogs.map((log) => (
                                                <tr key={log.id} className={log.role === 'guest' ? 'guest-row' : undefined}>
                                                    <td>{formatDateTime(log.createdAt)}</td>
                                                    <td>{log.username}</td>
                                                    <td><span className={ROLE_POLICY.getRoleBadgeClass(log.role as any)}>{log.role}</span></td>
                                                    <td className="hint" style={{ fontFamily: 'var(--mono)' }}>{log.ip}</td>
                                                    <td className="hint">{log.action}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <Empty title="暂无登录日志" />
                            )}
                        </Panel>

                        <div className="notice mist">
                            <h4>Cloudflare 免费额度参考</h4>
                            <div className="hint">
                                <div>• Workers: 每日 10 万次请求</div>
                                <div>• D1 数据库: 每日 500 万行读取 / 10 万行写入</div>
                                <div>• R2 存储: 10GB 存储 + 每月 1000 万次操作</div>
                            </div>
                        </div>
                    </>
                ) : (
                    <Empty title="无法加载统计数据" />
                )}
            </div>
        )}

        {activeTab === 'about' && (
            <div className="settings-stack wide">
                <AboutPage />
            </div>
        )}

        {activeTab === 'profile' && (
            <div className="settings-stack wide">
                <section className="settings-block">
                    <div className="settings-block-head">
                        <h3>账号</h3>
                    </div>
                    <div className="settings-pair account-pair">
                        <Panel title="Discord">
                            {currentUser.discordId ? (
                                <p className="hint">已关联：{currentUser.discordUsername || currentUser.discordId}</p>
                            ) : (
                                <>
                                    <p className="hint">关联后可用 Discord 登录此账号。</p>
                                    <Button onClick={() => { window.location.href = '/api/auth/discord?link=1'; }}>
                                        <IconDiscord />
                                        关联 Discord
                                    </Button>
                                </>
                            )}
                        </Panel>
                        {currentUser.role !== 'guest' && (
                            <Panel title="修改密码">
                                <div className="pref-row">
                                    <Input
                                        type="password"
                                        value={myNewPassword}
                                        onChange={e => setMyNewPassword(e.target.value)}
                                        placeholder="新密码"
                                        aria-label="新密码"
                                    />
                                    <Button className="pref-action" onClick={handleChangePassword}>更新密码</Button>
                                </div>
                            </Panel>
                        )}
                        <Panel title="API Key" className="account-api-key">
                            <ApiKeyFields />
                        </Panel>
                    </div>
                </section>
                <section className="settings-block">
                    <div className="settings-block-head">
                        <h3>偏好</h3>
                    </div>
                    <div className="settings-pair">
                        <Panel title="本地图片压缩">
                            <div className="pref-row">
                                <div>自动 JPG 保存</div>
                                <Switch
                                    checked={autoJpg}
                                    onCheckedChange={handleAutoJpgChange}
                                    aria-label="自动 JPG 保存"
                                />
                            </div>
                            <Field label={`JPG 质量 ${jpgQuality.toFixed(2)}`}>
                                <input
                                    type="range"
                                    className="range"
                                    min="0.1"
                                    max="1"
                                    step="0.01"
                                    value={jpgQuality}
                                    onChange={e => handleQualityChange(parseFloat(e.target.value))}
                                />
                            </Field>
                            <div className="pref-row hint">
                                <span>更小（0.10）</span>
                                <span>更清晰（1.00）</span>
                            </div>
                        </Panel>
                        <Panel title="军火库">
                            <Seg
                                fill
                                aria-label="权重语法"
                                value={artistWeightSyntax}
                                onChange={handleArtistWeightSyntaxChange}
                                options={[
                                    { value: 'numeric', label: '数字权重' },
                                    { value: 'bracket', label: '括号权重' },
                                ]}
                            />
                        </Panel>
                        <ApiEndpointSettings />
                    </div>
                </section>
                <AppearanceSettings />
            </div>
        )}
      </div>
    </div>
  );
};
