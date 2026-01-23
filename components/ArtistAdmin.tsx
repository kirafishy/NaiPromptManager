
import React, { useState, useEffect } from 'react';
import { db } from '../services/dbService';
import { Artist, User } from '../types';

interface ExtendedArtistAdminProps {
    currentUser: User;
    artistsData: Artist[] | null;
    usersData: User[] | null;
    onRefreshArtists: () => Promise<void>;
    onRefreshUsers: () => Promise<void>;
    isDark?: boolean;
    toggleTheme?: () => void;
    onLogout?: () => void;
}

export const ArtistAdmin: React.FC<ExtendedArtistAdminProps> = ({ 
    currentUser, artistsData, usersData, onRefreshArtists, onRefreshUsers, 
    isDark, toggleTheme, onLogout 
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [activeTab, setActiveTab] = useState<'artist' | 'users' | 'profile'>(isAdmin ? 'artist' : 'profile');
  
  // Artist State (Managed via props now, filtered here if needed)
  const artists = artistsData || [];
  
  // User Management State
  const users = usersData || [];
  
  const [artistName, setArtistName] = useState('');
  const [artistImg, setArtistImg] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Guest Code State
  const [guestCode, setGuestCode] = useState('');
  const [isUpdatingGuest, setIsUpdatingGuest] = useState(false);
  const [showGuestCode, setShowGuestCode] = useState(false); // Visibility toggle

  // Profile State
  const [myNewPassword, setMyNewPassword] = useState('');

  // Storage calculation helpers
  const MAX_STORAGE = 300 * 1024 * 1024;
  const formatBytes = (bytes?: number) => {
      if (!bytes) return '0 MB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  const getUsagePercentage = () => {
      if (!currentUser || !currentUser.storageUsage) return 0;
      return Math.min(100, (currentUser.storageUsage / MAX_STORAGE) * 100);
  };

  const handleRefresh = async () => {
      setIsLoading(true);
      if (activeTab === 'artist') await onRefreshArtists();
      if (activeTab === 'users') await onRefreshUsers();
      setIsLoading(false);
  };

  const handleArtistSave = async () => {
    if (!artistName.trim() || !artistImg.trim()) return;
    setIsLoading(true);
    const id = editingId || crypto.randomUUID();
    await db.saveArtist({ id, name: artistName.trim(), imageUrl: artistImg });
    
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
      if(confirm('确定删除该画师吗？')) {
          setIsLoading(true);
          await db.deleteArtist(id);
          await onRefreshArtists();
          setIsLoading(false);
      }
  };

  const handleCreateUser = async () => {
      if(!newUsername || !newPassword) return;
      setIsLoading(true);
      try {
        await db.createUser(newUsername, newPassword);
        setNewUsername(''); setNewPassword('');
        await onRefreshUsers();
        alert('用户创建成功');
      } catch(e) { alert('创建失败：用户名可能已存在'); }
      setIsLoading(false);
  };

  const handleDeleteUser = async (id: string) => {
      if(confirm('删除用户？')) {
          setIsLoading(true);
          await db.deleteUser(id);
          await onRefreshUsers();
          setIsLoading(false);
      }
  };

  // Fetch Guest Code when Users Tab is active
  useEffect(() => {
      if (isAdmin && activeTab === 'users') {
          db.getGuestCode().then(setGuestCode).catch(console.error);
      }
  }, [activeTab, isAdmin]);

  const handleUpdateGuestCode = async () => {
      if (!guestCode) return;
      setIsUpdatingGuest(true);
      try {
          await db.updateGuestCode(guestCode);
          alert('游客口令已更新');
      } catch(e) { alert('更新失败'); }
      setIsUpdatingGuest(false);
  };

  const handleChangePassword = async () => {
      if(!myNewPassword) return;
      await db.updatePassword(myNewPassword);
      setMyNewPassword('');
      alert('密码修改成功');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => setArtistImg(reader.result as string);
          reader.readAsDataURL(file);
      }
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-900 p-8 overflow-y-auto relative">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">系统管理</h1>
            {isAdmin && activeTab !== 'profile' && (
                <button 
                    onClick={handleRefresh} 
                    className={`p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors`}
                    title="刷新列表"
                >
                    <svg className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
            )}
        </div>

        <div className="flex space-x-4 mb-8 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            {isAdmin && (
                <>
                    <button onClick={() => setActiveTab('artist')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'artist' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>画师管理</button>
                    <button onClick={() => setActiveTab('users')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'users' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>用户管理</button>
                </>
            )}
            <button onClick={() => setActiveTab('profile')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'profile' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>个人设置</button>
        </div>

        {/* --- ARTIST TAB --- */}
        {activeTab === 'artist' && isAdmin && (
            <>
                {/* Sticky Header Container */}
                <div className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 pb-4 pt-2 -mt-2">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
                        <h2 className="font-bold dark:text-white mb-4">{editingId ? '编辑画师' : '添加画师'}</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <input type="text" value={artistName} onChange={e => setArtistName(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="画师名称" />
                            <div className="flex gap-2">
                                <input type="file" onChange={handleFileUpload} className="hidden" id="art-up" />
                                <label htmlFor="art-up" className="px-3 py-2 bg-gray-200 rounded cursor-pointer text-sm flex items-center hover:bg-gray-300 transition-colors whitespace-nowrap">上传</label>
                                <input type="text" value={artistImg} onChange={e => setArtistImg(e.target.value)} className="flex-1 min-w-0 p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="图片 URL/Base64" />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleArtistSave} className="bg-indigo-600 text-white px-6 py-2 rounded hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/30">{editingId ? '保存修改' : '添加'}</button>
                            {editingId && <button onClick={handleCancelEdit} className="bg-gray-400 text-white px-6 py-2 rounded hover:bg-gray-300 transition-colors">取消</button>}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-20">
                    {artists.map(a => (
                        <div key={a.id} className="bg-white dark:bg-gray-800 p-4 rounded shadow flex items-center justify-between group hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-2 overflow-hidden">
                                <img src={a.imageUrl} className="w-8 h-8 rounded object-cover flex-shrink-0" loading="lazy" />
                                <span className="dark:text-white font-bold text-sm truncate">{a.name}</span>
                            </div>
                            <div className="flex gap-2 text-xs flex-shrink-0 ml-2">
                                <button onClick={() => handleEditArtist(a)} className="text-indigo-500 hover:text-indigo-700 font-medium">编辑</button>
                                <button onClick={() => handleArtistDelete(a.id)} className="text-red-500 hover:text-red-700">删除</button>
                            </div>
                        </div>
                    ))}
                </div>
            </>
        )}

        {/* --- USER TAB --- */}
        {activeTab === 'users' && isAdmin && (
            <div className="space-y-6">
                {/* Create User Block */}
                 <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
                    <h2 className="font-bold dark:text-white mb-4">创建用户</h2>
                    <div className="flex flex-col md:flex-row gap-4 mb-4">
                        <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="flex-1 p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="用户名" />
                        <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="flex-1 p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="密码" />
                        <button onClick={handleCreateUser} className="bg-indigo-600 text-white px-4 py-2 rounded">创建</button>
                    </div>
                </div>

                {/* Guest Settings Block */}
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6 rounded-xl shadow">
                    <h2 className="font-bold text-gray-800 dark:text-gray-200 mb-2">游客访问设置</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">设置游客登录时使用的全局口令。下方显示的是当前生效的口令。</p>
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="relative flex-1">
                            <input 
                                type={showGuestCode ? "text" : "password"}
                                value={guestCode} 
                                onChange={e => setGuestCode(e.target.value)} 
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 dark:text-white font-mono pr-10" 
                                placeholder="游客口令" 
                            />
                            <button 
                                onClick={() => setShowGuestCode(!showGuestCode)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 p-1"
                                title={showGuestCode ? "隐藏口令" : "显示口令"}
                            >
                                {showGuestCode ? (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                )}
                            </button>
                        </div>
                        <button 
                            onClick={handleUpdateGuestCode} 
                            disabled={isUpdatingGuest}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                            {isUpdatingGuest ? '更新中...' : '更新口令'}
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full bg-white dark:bg-gray-800 rounded shadow">
                        <thead><tr className="text-left border-b dark:border-gray-700 text-gray-500 p-2"><th className="p-4">用户名</th><th className="p-4">角色</th><th className="p-4">注册时间</th><th className="p-4">操作</th></tr></thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-b dark:border-gray-700 last:border-0 dark:text-white">
                                    <td className="p-4">{u.username}</td>
                                    <td className="p-4"><span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{u.role}</span></td>
                                    <td className="p-4 text-sm text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                                    <td className="p-4">
                                        {u.id !== currentUser.id && u.role !== 'guest' && <button onClick={() => handleDeleteUser(u.id)} className="text-red-500">删除</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* --- PROFILE TAB --- */}
        {activeTab === 'profile' && (
            <div className="space-y-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-md">
                    <h2 className="font-bold dark:text-white mb-4">修改密码</h2>
                    <input type="password" value={myNewPassword} onChange={e => setMyNewPassword(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white mb-4" placeholder="新密码" />
                    <button onClick={handleChangePassword} className="bg-indigo-600 text-white px-6 py-2 rounded">更新密码</button>
                </div>
                
                {/* Mobile / Convenient Settings */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-md">
                     <h2 className="font-bold dark:text-white mb-4">应用设置</h2>
                     <div className="space-y-4">
                        {/* Storage Usage Display (Added for Mobile) */}
                        {currentUser.role !== 'admin' && (
                            <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                    <span>云端存储空间</span>
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

                        {toggleTheme && (
                            <button onClick={toggleTheme} className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                <span>{isDark ? '🌙 深色模式' : '☀️ 亮色模式'}</span>
                                <span className="text-xs text-gray-500">点击切换</span>
                            </button>
                        )}
                        {onLogout && (
                            <button onClick={onLogout} className="w-full flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                                <span>退出登录</span>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            </button>
                        )}
                     </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
