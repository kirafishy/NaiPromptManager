
import React, { useState, useEffect } from 'react';
import { db } from '../services/dbService';
import { Artist, User } from '../types';

interface ArtistAdminProps {
    currentUser: User;
}

export const ArtistAdmin: React.FC<ArtistAdminProps> = ({ currentUser }) => {
  const isAdmin = currentUser.role === 'admin';
  const [activeTab, setActiveTab] = useState<'artist' | 'users' | 'profile'>(isAdmin ? 'artist' : 'profile');
  
  // Artist State
  const [artists, setArtists] = useState<Artist[]>([]);
  const [artistName, setArtistName] = useState('');
  const [artistImg, setArtistImg] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // User Management State
  const [users, setUsers] = useState<User[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Profile State
  const [myNewPassword, setMyNewPassword] = useState('');

  useEffect(() => {
    if (activeTab === 'artist' && isAdmin) refreshArtists();
    if (activeTab === 'users' && isAdmin) refreshUsers();
  }, [activeTab]);

  const refreshArtists = async () => {
    const data = await db.getAllArtists();
    setArtists(data.sort((a, b) => a.name.localeCompare(b.name)));
  };

  const refreshUsers = async () => {
      const data = await db.getUsers();
      setUsers(data);
  };

  const handleArtistSave = async () => {
    if (!artistName.trim() || !artistImg.trim()) return;
    const id = editingId || crypto.randomUUID();
    await db.saveArtist({ id, name: artistName.trim(), imageUrl: artistImg });
    
    setArtistName(''); 
    setArtistImg(''); 
    setEditingId(null);
    refreshArtists();
  };

  const handleEditArtist = (artist: Artist) => {
      setEditingId(artist.id);
      setArtistName(artist.name);
      setArtistImg(artist.imageUrl);
      // Removed scrollTo, sticky handles visibility
  };

  const handleCancelEdit = () => {
      setEditingId(null);
      setArtistName('');
      setArtistImg('');
  };

  const handleArtistDelete = async (id: string) => {
      if(confirm('确定删除该画师吗？')) {
          await db.deleteArtist(id);
          refreshArtists();
      }
  };

  const handleCreateUser = async () => {
      if(!newUsername || !newPassword) return;
      try {
        await db.createUser(newUsername, newPassword);
        setNewUsername(''); setNewPassword('');
        refreshUsers();
        alert('用户创建成功');
      } catch(e) { alert('创建失败：用户名可能已存在'); }
  };

  const handleDeleteUser = async (id: string) => {
      if(confirm('删除用户？')) {
          await db.deleteUser(id);
          refreshUsers();
      }
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
    <div className="flex-1 bg-gray-50 dark:bg-gray-900 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">系统管理</h1>

        <div className="flex space-x-4 mb-8 border-b border-gray-200 dark:border-gray-700">
            {isAdmin && (
                <>
                    <button onClick={() => setActiveTab('artist')} className={`pb-3 px-2 border-b-2 ${activeTab === 'artist' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>画师管理</button>
                    <button onClick={() => setActiveTab('users')} className={`pb-3 px-2 border-b-2 ${activeTab === 'users' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>用户管理</button>
                </>
            )}
            <button onClick={() => setActiveTab('profile')} className={`pb-3 px-2 border-b-2 ${activeTab === 'profile' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>个人设置</button>
        </div>

        {/* --- ARTIST TAB --- */}
        {activeTab === 'artist' && isAdmin && (
            <>
                {/* Sticky Header Container */}
                <div className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 pb-4 pt-2 -mt-2">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
                        <h2 className="font-bold dark:text-white mb-4">{editingId ? '编辑画师' : '添加画师'}</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <input type="text" value={artistName} onChange={e => setArtistName(e.target.value)} className="p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="画师名称" />
                            <div className="flex gap-2">
                                <input type="file" onChange={handleFileUpload} className="hidden" id="art-up" />
                                <label htmlFor="art-up" className="px-3 py-2 bg-gray-200 rounded cursor-pointer text-sm flex items-center hover:bg-gray-300 transition-colors">上传</label>
                                <input type="text" value={artistImg} onChange={e => setArtistImg(e.target.value)} className="flex-1 p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="图片 URL/Base64" />
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
                            <div className="flex items-center gap-2">
                                <img src={a.imageUrl} className="w-8 h-8 rounded object-cover" loading="lazy" />
                                <span className="dark:text-white font-bold text-sm">{a.name}</span>
                            </div>
                            <div className="flex gap-2 text-xs">
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
            <>
                 <div className="bg-white dark:bg-gray-800 p-6 rounded-xl mb-8 shadow">
                    <h2 className="font-bold dark:text-white mb-4">创建用户</h2>
                    <div className="flex gap-4 mb-4">
                        <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="用户名" />
                        <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="密码" />
                        <button onClick={handleCreateUser} className="bg-indigo-600 text-white px-4 rounded">创建</button>
                    </div>
                </div>
                <table className="w-full bg-white dark:bg-gray-800 rounded shadow">
                    <thead><tr className="text-left border-b dark:border-gray-700 text-gray-500 p-2"><th className="p-4">用户名</th><th className="p-4">角色</th><th className="p-4">注册时间</th><th className="p-4">操作</th></tr></thead>
                    <tbody>
                        {users.map(u => (
                            <tr key={u.id} className="border-b dark:border-gray-700 last:border-0 dark:text-white">
                                <td className="p-4">{u.username}</td>
                                <td className="p-4"><span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{u.role}</span></td>
                                <td className="p-4 text-sm text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                                <td className="p-4">
                                    {u.id !== currentUser.id && <button onClick={() => handleDeleteUser(u.id)} className="text-red-500">删除</button>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </>
        )}

        {/* --- PROFILE TAB --- */}
        {activeTab === 'profile' && (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-md">
                <h2 className="font-bold dark:text-white mb-4">修改密码</h2>
                <input type="password" value={myNewPassword} onChange={e => setMyNewPassword(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white mb-4" placeholder="新密码" />
                <button onClick={handleChangePassword} className="bg-indigo-600 text-white px-6 py-2 rounded">更新密码</button>
            </div>
        )}
      </div>
    </div>
  );
};
