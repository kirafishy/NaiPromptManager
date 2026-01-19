
import React, { useState, useEffect } from 'react';
import { localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import { LocalGenItem, User } from '../types';

interface GenHistoryProps {
    currentUser: User;
}

export const GenHistory: React.FC<GenHistoryProps> = ({ currentUser }) => {
    const [items, setItems] = useState<LocalGenItem[]>([]);
    const [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishTitle, setPublishTitle] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const data = await localHistory.getAll();
        setItems(data);
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('确定删除这张图片记录吗？(无法恢复)')) {
            await localHistory.delete(id);
            if (lightbox?.id === id) setLightbox(null);
            loadData();
        }
    };

    const handleClearAll = async () => {
        if (confirm('确定清空所有本地生图历史吗？')) {
            await localHistory.clear();
            setItems([]);
        }
    };

    const handlePublish = async () => {
        if (!lightbox) return;
        if (!publishTitle.trim()) {
            alert('请输入标题');
            return;
        }
        setIsPublishing(true);
        try {
            await db.saveInspiration({
                id: crypto.randomUUID(),
                title: publishTitle,
                imageUrl: lightbox.imageUrl,
                prompt: lightbox.prompt,
                userId: currentUser.id,
                username: currentUser.username,
                createdAt: Date.now()
            });
            alert('发布成功！已加入灵感图库');
            setIsPublishing(false);
            setPublishTitle('');
            // Optional: Close lightbox or stay
        } catch (e: any) {
            alert('发布失败: ' + e.message);
            setIsPublishing(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
             <header className="p-6 bg-white dark:bg-gray-800 shadow-md flex justify-between items-center border-b border-gray-200 dark:border-gray-700 z-10">
                 <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">本地生图历史</h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400">仅存储在您的浏览器中，不会自动上传到服务器</p>
                 </div>
                 <div className="flex gap-3">
                     <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">共 {items.length} 张</div>
                     <button onClick={handleClearAll} className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-sm hover:bg-red-200 dark:hover:bg-red-900/50">清空历史</button>
                 </div>
             </header>

             <div className="flex-1 overflow-y-auto p-6 pb-20">
                 {items.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-gray-400">
                         <div className="text-4xl mb-2">🕰️</div>
                         <p>暂无生成记录</p>
                         <p className="text-sm mt-2">在 Chain 编辑器中生成图片会自动保存到这里</p>
                     </div>
                 ) : (
                     <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                         {items.map(item => (
                             <div 
                                key={item.id} 
                                className="group relative aspect-square bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-indigo-500 transition-colors"
                                onClick={() => setLightbox(item)}
                             >
                                 <img src={item.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                                 <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                 <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                     <button onClick={(e) => handleDelete(item.id, e)} className="p-1.5 bg-red-500 text-white rounded-full shadow hover:bg-red-600">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                     </button>
                                 </div>
                                 <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity truncate">
                                     {new Date(item.createdAt).toLocaleString()}
                                 </div>
                             </div>
                         ))}
                     </div>
                 )}
             </div>

             {/* Lightbox */}
             {lightbox && (
                 <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8" onClick={() => setLightbox(null)}>
                     <div className="bg-white dark:bg-gray-900 w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                         <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative">
                             <img src={lightbox.imageUrl} className="max-w-full max-h-full object-contain" />
                         </div>
                         <div className="w-full md:w-96 bg-white dark:bg-gray-900 flex flex-col p-6 border-l border-gray-200 dark:border-gray-800">
                             <div className="flex justify-between items-center mb-6">
                                 <h2 className="text-xl font-bold text-gray-900 dark:text-white">图片详情</h2>
                                 <button onClick={() => setLightbox(null)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white">✕</button>
                             </div>

                             <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                                 <div>
                                     <label className="text-xs font-bold text-gray-500 uppercase">Prompt</label>
                                     <p className="text-xs text-gray-700 dark:text-gray-300 font-mono break-words bg-gray-50 dark:bg-gray-800 p-2 rounded mt-1">{lightbox.prompt}</p>
                                 </div>
                                 <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
                                     <div>尺寸: {lightbox.params.width}x{lightbox.params.height}</div>
                                     <div>Steps: {lightbox.params.steps}</div>
                                     <div>Scale: {lightbox.params.scale}</div>
                                     <div>Sampler: {lightbox.params.sampler}</div>
                                 </div>
                             </div>

                             <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-3">
                                 <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                                     <label className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">发布到灵感图库</label>
                                     <div className="flex gap-2">
                                         <input 
                                            type="text" 
                                            placeholder="输入标题..." 
                                            className="flex-1 px-3 py-2 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800 text-sm outline-none dark:text-white"
                                            value={publishTitle}
                                            onChange={e => setPublishTitle(e.target.value)}
                                         />
                                         <button 
                                            onClick={handlePublish}
                                            disabled={isPublishing}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold whitespace-nowrap disabled:opacity-50"
                                         >
                                             {isPublishing ? '发布中' : '发布'}
                                         </button>
                                     </div>
                                 </div>
                                 <button onClick={() => navigator.clipboard.writeText(lightbox.prompt)} className="w-full py-2 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">复制 Prompt</button>
                             </div>
                         </div>
                     </div>
                 </div>
             )}
        </div>
    );
};
