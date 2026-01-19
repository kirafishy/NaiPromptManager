import React, { useState, useEffect } from 'react';
import { db } from '../services/dbService';
import { Artist, Inspiration } from '../types';
import { extractMetadata } from '../services/metadataService';

export const ArtistAdmin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'artist' | 'inspiration'>('artist');
  
  // --- Artist State ---
  const [artists, setArtists] = useState<Artist[]>([]);
  const [artistEditingId, setArtistEditingId] = useState<string | null>(null);
  const [artistName, setArtistName] = useState('');
  const [artistImg, setArtistImg] = useState(''); // Stores Base64 or URL

  // --- Inspiration State ---
  const [inspirations, setInspirations] = useState<Inspiration[]>([]);
  const [inspEditingId, setInspEditingId] = useState<string | null>(null);
  const [inspTitle, setInspTitle] = useState('');
  const [inspPrompt, setInspPrompt] = useState('');
  const [inspImg, setInspImg] = useState(''); // Stores Base64 or URL

  // Initial Load
  useEffect(() => {
    refreshArtists();
    refreshInspirations();
  }, []);

  const refreshArtists = async () => {
    const data = await db.getAllArtists();
    setArtists(data.sort((a, b) => a.name.localeCompare(b.name)));
  };

  const refreshInspirations = async () => {
    const data = await db.getAllInspirations();
    setInspirations(data);
  };

  // --- Helpers ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void, isInspiration: boolean = false) => {
      const file = e.target.files?.[0];
      if (file) {
          // 1. Read Image for Display/Storage
          const reader = new FileReader();
          reader.onloadend = () => {
              setter(reader.result as string);
          };
          reader.readAsDataURL(file);

          // 2. If Inspiration, try to read Metadata
          if (isInspiration) {
              const metaPrompt = await extractMetadata(file);
              if (metaPrompt) {
                  setInspPrompt(metaPrompt);
                  // Optional: Auto-set title if empty
                  if (!inspTitle) {
                      setInspTitle(file.name.replace(/\.[^/.]+$/, ""));
                  }
                  alert('已成功读取图片 Metadata 并填充 Prompt！');
              }
          }
      }
  };

  // --- Artist Logic ---
  const handleArtistEdit = (artist: Artist) => {
    setArtistEditingId(artist.id);
    setArtistName(artist.name);
    setArtistImg(artist.imageUrl);
  };

  const handleArtistCancel = () => {
    setArtistEditingId(null);
    setArtistName('');
    setArtistImg('');
  };

  const handleArtistSave = async () => {
    if (!artistName.trim() || !artistImg.trim()) return;
    const id = artistEditingId || crypto.randomUUID();
    await db.saveArtist({ id, name: artistName.trim(), imageUrl: artistImg });
    handleArtistCancel();
    refreshArtists();
  };

  const handleArtistDelete = async (id: string) => {
      if(confirm('确定删除该画师吗？')) {
          await db.deleteArtist(id);
          refreshArtists();
      }
  };

  // --- Inspiration Logic ---
  const handleInspEdit = (item: Inspiration) => {
    setInspEditingId(item.id);
    setInspTitle(item.title);
    setInspPrompt(item.prompt);
    setInspImg(item.imageUrl);
  };

  const handleInspCancel = () => {
    setInspEditingId(null);
    setInspTitle('');
    setInspPrompt('');
    setInspImg('');
  };

  const handleInspSave = async () => {
    if (!inspTitle.trim() || !inspImg.trim()) return;
    const id = inspEditingId || crypto.randomUUID();
    await db.saveInspiration({ 
        id, 
        title: inspTitle.trim(), 
        prompt: inspPrompt, 
        imageUrl: inspImg,
        createdAt: Date.now()
    });
    handleInspCancel();
    refreshInspirations();
  };

  const handleInspDelete = async (id: string) => {
      if(confirm('确定删除该灵感图吗？')) {
          await db.deleteInspiration(id);
          refreshInspirations();
      }
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-900 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">后台数据管理</h1>

        {/* Tab Switcher */}
        <div className="flex space-x-4 mb-8 border-b border-gray-200 dark:border-gray-700">
            <button 
                onClick={() => setActiveTab('artist')}
                className={`pb-3 px-2 font-medium transition-colors border-b-2 ${activeTab === 'artist' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
            >
                画师管理
            </button>
            <button 
                onClick={() => setActiveTab('inspiration')}
                className={`pb-3 px-2 font-medium transition-colors border-b-2 ${activeTab === 'inspiration' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
            >
                灵感图库管理
            </button>
        </div>

        {/* --- ARTIST TAB --- */}
        {activeTab === 'artist' && (
            <>
                {/* Artist Form */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 mb-8 shadow-lg">
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-4">{artistEditingId ? '编辑画师' : '添加新画师'}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                        <div>
                            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">画师名称 (Name)</label>
                            <input type="text" value={artistName} onChange={e => setArtistName(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white outline-none focus:border-indigo-500" placeholder="e.g. wlop" />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">预览图 (支持上传或 URL)</label>
                            <div className="flex gap-2">
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    onChange={(e) => handleFileUpload(e, setArtistImg)} 
                                    className="hidden" 
                                    id="artist-upload"
                                />
                                <label htmlFor="artist-upload" className="cursor-pointer px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm flex items-center">
                                    📁 上传图片
                                </label>
                                <input 
                                    type="text" 
                                    value={artistImg} 
                                    onChange={e => setArtistImg(e.target.value)} 
                                    className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white outline-none focus:border-indigo-500 text-sm" 
                                    placeholder="或粘贴图片链接..." 
                                />
                            </div>
                            {artistImg && <div className="mt-2 text-xs text-green-500 truncate">已加载图片: {artistImg.substring(0, 50)}...</div>}
                        </div>
                    </div>
                    <div className="flex justify-end gap-3">
                        {artistEditingId && <button onClick={handleArtistCancel} className="px-4 py-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">取消</button>}
                        <button onClick={handleArtistSave} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold">
                            {artistEditingId ? '保存修改' : '添加画师'}
                        </button>
                    </div>
                </div>

                {/* Artist List */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full text-left text-sm text-gray-600 dark:text-gray-400">
                        <thead className="bg-gray-100 dark:bg-gray-950 text-gray-700 dark:text-gray-200 uppercase font-bold">
                            <tr>
                                <th className="p-4">预览</th>
                                <th className="p-4">名称</th>
                                <th className="p-4">图片源</th>
                                <th className="p-4 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {artists.map(artist => (
                                <tr key={artist.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                                    <td className="p-4">
                                        <img src={artist.imageUrl} alt="" className="w-10 h-10 object-cover rounded bg-gray-200 dark:bg-gray-900" />
                                    </td>
                                    <td className="p-4 font-medium text-gray-900 dark:text-white">{artist.name}</td>
                                    <td className="p-4 truncate max-w-xs text-xs font-mono opacity-60">
                                        {artist.imageUrl.startsWith('data:') ? '本地上传 (Base64)' : artist.imageUrl}
                                    </td>
                                    <td className="p-4 text-right space-x-2">
                                        <button onClick={() => handleArtistEdit(artist)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">编辑</button>
                                        <button onClick={() => handleArtistDelete(artist.id)} className="text-red-600 dark:text-red-400 hover:text-red-500 dark:hover:text-red-300">删除</button>
                                    </td>
                                </tr>
                            ))}
                            {artists.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-500">暂无数据</td></tr>}
                        </tbody>
                    </table>
                </div>
            </>
        )}

        {/* --- INSPIRATION TAB --- */}
        {activeTab === 'inspiration' && (
             <>
                {/* Inspiration Form */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 mb-8 shadow-lg">
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-4">{inspEditingId ? '编辑灵感图' : '添加灵感图'}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                        <div className="md:col-span-2">
                             <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">图片 (支持上传或 URL)</label>
                            <div className="flex gap-2">
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    onChange={(e) => handleFileUpload(e, setInspImg, true)} 
                                    className="hidden" 
                                    id="insp-upload"
                                />
                                <label htmlFor="insp-upload" className="cursor-pointer px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm flex items-center">
                                    📁 上传图片 (自动读取 Prompt)
                                </label>
                                <input 
                                    type="text" 
                                    value={inspImg} 
                                    onChange={e => setInspImg(e.target.value)} 
                                    className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white outline-none focus:border-indigo-500 text-sm" 
                                    placeholder="或粘贴图片链接..." 
                                />
                            </div>
                             {inspImg && (
                                 <div className="mt-2">
                                     <img src={inspImg} alt="Preview" className="h-32 object-contain rounded border border-gray-600" />
                                 </div>
                             )}
                        </div>
                        <div>
                            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">标题</label>
                            <input type="text" value={inspTitle} onChange={e => setInspTitle(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white outline-none focus:border-indigo-500" placeholder="例如：赛博朋克风格测试" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Prompt</label>
                            <textarea value={inspPrompt} onChange={e => setInspPrompt(e.target.value)} className="w-full h-24 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white outline-none focus:border-indigo-500 font-mono text-sm" placeholder="上传图片后自动填充，或手动输入..." />
                        </div>
                    </div>
                    <div className="flex justify-end gap-3">
                        {inspEditingId && <button onClick={handleInspCancel} className="px-4 py-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">取消</button>}
                        <button onClick={handleInspSave} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold">
                            {inspEditingId ? '保存修改' : '保存灵感'}
                        </button>
                    </div>
                </div>

                {/* Inspiration List */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full text-left text-sm text-gray-600 dark:text-gray-400">
                        <thead className="bg-gray-100 dark:bg-gray-950 text-gray-700 dark:text-gray-200 uppercase font-bold">
                            <tr>
                                <th className="p-4">预览</th>
                                <th className="p-4">标题</th>
                                <th className="p-4">Prompt</th>
                                <th className="p-4 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {inspirations.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                                    <td className="p-4">
                                        <img src={item.imageUrl} alt="" className="w-16 h-16 object-cover rounded bg-gray-200 dark:bg-gray-900" />
                                    </td>
                                    <td className="p-4 font-medium text-gray-900 dark:text-white">{item.title}</td>
                                    <td className="p-4">
                                        <div className="max-w-xs truncate opacity-75 font-mono text-xs">{item.prompt}</div>
                                    </td>
                                    <td className="p-4 text-right space-x-2">
                                        <button onClick={() => handleInspEdit(item)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">编辑</button>
                                        <button onClick={() => handleInspDelete(item.id)} className="text-red-600 dark:text-red-400 hover:text-red-500 dark:hover:text-red-300">删除</button>
                                    </td>
                                </tr>
                            ))}
                            {inspirations.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-500">暂无灵感图</td></tr>}
                        </tbody>
                    </table>
                </div>
             </>
        )}
      </div>
    </div>
  );
};
