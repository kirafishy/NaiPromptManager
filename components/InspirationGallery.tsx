
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/dbService';
import { Inspiration, User } from '../types';
import { extractMetadata } from '../services/metadataService';

interface InspirationGalleryProps {
    currentUser: User;
    // New props for caching
    inspirationsData: Inspiration[] | null;
    onRefresh: () => Promise<void>;
}

// Lazy Loading Component (Reused logic, kept separate per component for modularity if needed)
const LazyImage: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [isInView, setIsInView] = useState(false);
    const imgRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                setIsInView(true);
                observer.disconnect();
            }
        }, { threshold: 0.1 });

        if (imgRef.current) observer.observe(imgRef.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={imgRef} className="w-full h-full relative bg-gray-200 dark:bg-gray-900 overflow-hidden">
            {isInView && (
                <img 
                    src={src} 
                    alt={alt} 
                    className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${isLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-105'}`}
                    onLoad={() => setIsLoaded(true)}
                />
            )}
            {!isLoaded && isInView && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    <span className="animate-pulse">Loading...</span>
                </div>
            )}
        </div>
    );
};

export const InspirationGallery: React.FC<InspirationGalleryProps> = ({ currentUser, inspirationsData, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [lightboxImg, setLightboxImg] = useState<{item: Inspiration, isEditing: boolean} | null>(null);
  const [uploadMode, setUploadMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Upload State
  const [upTitle, setUpTitle] = useState('');
  const [upImg, setUpImg] = useState('');
  const [upPrompt, setUpPrompt] = useState('');

  useEffect(() => {
    const initData = async () => {
        if (!inspirationsData) {
            handleRefresh();
        }
    };
    initData();
  }, []);

  const handleRefresh = async () => {
      setIsLoading(true);
      await onRefresh();
      setIsLoading(false);
  };

  const copyPrompt = (prompt: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    navigator.clipboard.writeText(prompt);
    alert('Prompt 已复制');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => setUpImg(reader.result as string);
        reader.readAsDataURL(file);
        const meta = await extractMetadata(file);
        if (meta) {
            setUpPrompt(meta);
            if (!upTitle) setUpTitle(file.name.replace(/\.[^/.]+$/, ""));
        }
    }
  };

  const handleUpload = async () => {
      if (!upTitle || !upImg) return;
      await db.saveInspiration({
          id: crypto.randomUUID(),
          title: upTitle,
          imageUrl: upImg,
          prompt: upPrompt,
          userId: currentUser.id,
          username: currentUser.username,
          createdAt: Date.now()
      });
      setUploadMode(false);
      setUpTitle(''); setUpImg(''); setUpPrompt('');
      onRefresh();
  };

  const handleSaveEdit = async () => {
      if (!lightboxImg) return;
      await db.updateInspiration(lightboxImg.item.id, {
          title: lightboxImg.item.title,
          prompt: lightboxImg.item.prompt
      });
      setLightboxImg(null);
      onRefresh();
  };

  const toggleSelection = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedIds(newSet);
  };

  const handleBulkDelete = async () => {
      if (selectedIds.size === 0) return;
      if (!confirm(`确认删除选中的 ${selectedIds.size} 张图片吗？`)) return;
      await db.bulkDeleteInspirations(Array.from(selectedIds));
      setSelectedIds(new Set());
      setSelectionMode(false);
      onRefresh();
  };

  const canEdit = (item: Inspiration) => item.userId === currentUser.id || currentUser.role === 'admin';

  const filtered = (inspirationsData || []).filter(i => 
    i.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    i.prompt.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
      {/* Header */}
      <header className="p-6 bg-white dark:bg-gray-800 shadow-md flex flex-col md:flex-row gap-4 items-center justify-between border-b border-gray-200 dark:border-gray-700 z-10 flex-shrink-0">
          <div className="flex items-center gap-4">
             <div>
                 <h1 className="text-2xl font-bold text-gray-900 dark:text-white">灵感图库</h1>
                 <p className="text-xs text-gray-500 dark:text-gray-400">收藏优秀的生成结果与 Prompt</p>
             </div>
             {/* Refresh Button (Added) */}
            <button 
                onClick={handleRefresh} 
                className={`p-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors ${isLoading ? 'animate-spin' : ''}`}
                title="刷新灵感库"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
          
          <div className="flex gap-2 items-center w-full md:w-auto">
              {selectionMode ? (
                  <>
                    <span className="text-sm text-gray-500">已选 {selectedIds.size}</span>
                    <button onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm">删除选中</button>
                    <button onClick={() => {setSelectionMode(false); setSelectedIds(new Set())}} className="text-gray-500 px-3">取消</button>
                  </>
              ) : (
                  <>
                    <input 
                        type="text" 
                        placeholder="搜索..." 
                        className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-full px-4 py-2 text-sm outline-none"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                    <button onClick={() => setSelectionMode(true)} className="bg-gray-200 dark:bg-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-300">批量管理</button>
                    <button onClick={() => setUploadMode(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        上传
                    </button>
                  </>
              )}
          </div>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6 pb-20 relative">
             {isLoading && (
                 <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-gray-900/80 z-20">
                     <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
                 </div>
             )}

             <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                 {filtered.map(item => (
                     <div 
                        key={item.id} 
                        className={`group bg-white dark:bg-gray-800 rounded-xl overflow-hidden border transition-all flex flex-col relative ${selectionMode && selectedIds.has(item.id) ? 'ring-2 ring-indigo-600 border-indigo-600' : 'border-gray-200 dark:border-gray-700'}`}
                        onClick={() => selectionMode ? toggleSelection(item.id) : null}
                     >
                         <div 
                            className="aspect-[2/3] md:aspect-square relative overflow-hidden cursor-zoom-in"
                            onClick={() => !selectionMode && setLightboxImg({item, isEditing: false})}
                         >
                             {/* Lazy Image */}
                             <LazyImage src={item.imageUrl} alt={item.title} />

                             {selectionMode && (
                                 <div className={`absolute inset-0 flex items-center justify-center bg-black/40`}>
                                     {selectedIds.has(item.id) && <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                 </div>
                             )}
                         </div>
                         <div className="p-3">
                             <div className="flex justify-between items-start">
                                <h3 className="font-bold text-gray-900 dark:text-white truncate flex-1" title={item.title}>{item.title}</h3>
                                {item.username && <span className="text-[10px] bg-gray-100 dark:bg-gray-700 px-1 rounded text-gray-500">{item.username}</span>}
                             </div>
                             <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 font-mono opacity-75">{item.prompt}</p>
                         </div>
                     </div>
                 ))}
             </div>
      </div>

      {/* Upload Modal */}
      {uploadMode && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-xl p-6 shadow-2xl">
                  <h2 className="text-xl font-bold mb-4 dark:text-white">上传灵感图</h2>
                  <div className="space-y-4">
                      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" id="up-file" />
                          <label htmlFor="up-file" className="cursor-pointer block">
                              {upImg ? <img src={upImg} className="h-32 mx-auto object-contain" /> : <span className="text-gray-500">点击选择图片 (自动读取 Prompt)</span>}
                          </label>
                      </div>
                      <input type="text" placeholder="标题" className="w-full p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" value={upTitle} onChange={e => setUpTitle(e.target.value)} />
                      <textarea placeholder="Prompt" className="w-full p-2 border rounded h-24 dark:bg-gray-900 dark:border-gray-600 dark:text-white" value={upPrompt} onChange={e => setUpPrompt(e.target.value)} />
                  </div>
                  <div className="flex justify-end gap-3 mt-6">
                      <button onClick={() => setUploadMode(false)} className="px-4 py-2 text-gray-500">取消</button>
                      <button onClick={handleUpload} className="px-4 py-2 bg-indigo-600 text-white rounded">上传</button>
                  </div>
              </div>
          </div>
      )}

      {/* Lightbox / Details Editor */}
      {lightboxImg && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8" onClick={() => setLightboxImg(null)}>
              <div className="bg-white dark:bg-gray-900 w-full max-w-[90vw] h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col lg:flex-row border border-gray-700" onClick={e => e.stopPropagation()}>
                  <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative overflow-hidden">
                      <img src={lightboxImg.item.imageUrl} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="w-full lg:w-[480px] bg-white dark:bg-gray-900 flex flex-col border-l border-gray-200 dark:border-gray-800 p-6">
                      <div className="flex justify-between items-start mb-4">
                          {lightboxImg.isEditing ? (
                              <input className="text-xl font-bold bg-gray-100 dark:bg-gray-800 border-none rounded p-1 w-full dark:text-white" value={lightboxImg.item.title} onChange={e => setLightboxImg({...lightboxImg, item: {...lightboxImg.item, title: e.target.value}})} />
                          ) : (
                              <div>
                                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{lightboxImg.item.title}</h2>
                                  <p className="text-sm text-gray-500">by {lightboxImg.item.username || 'Unknown'}</p>
                              </div>
                          )}
                          <button onClick={() => setLightboxImg(null)} className="text-gray-400 hover:text-white">✕</button>
                      </div>

                      <div className="flex-1 bg-gray-50 dark:bg-gray-950 p-4 rounded-lg border border-gray-200 dark:border-gray-800 overflow-y-auto mb-4">
                           {lightboxImg.isEditing ? (
                               <textarea className="w-full h-full bg-transparent outline-none resize-none font-mono text-sm dark:text-gray-300" value={lightboxImg.item.prompt} onChange={e => setLightboxImg({...lightboxImg, item: {...lightboxImg.item, prompt: e.target.value}})} />
                           ) : (
                               <p className="text-sm font-mono text-gray-800 dark:text-gray-300 break-words whitespace-pre-wrap">{lightboxImg.item.prompt}</p>
                           )}
                      </div>
                      
                      <div className="flex flex-col gap-3">
                          {lightboxImg.isEditing ? (
                              <div className="flex gap-2">
                                  <button onClick={handleSaveEdit} className="flex-1 bg-green-600 text-white py-2 rounded">保存</button>
                                  <button onClick={() => setLightboxImg({...lightboxImg, isEditing: false})} className="flex-1 bg-gray-500 text-white py-2 rounded">取消</button>
                              </div>
                          ) : (
                              <>
                                <button onClick={() => copyPrompt(lightboxImg.item.prompt)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">复制 Prompt</button>
                                {canEdit(lightboxImg.item) && (
                                    <button onClick={() => setLightboxImg({...lightboxImg, isEditing: true})} className="w-full py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg">编辑详情</button>
                                )}
                              </>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
