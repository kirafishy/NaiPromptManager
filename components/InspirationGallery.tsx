import React, { useState, useEffect } from 'react';
import { db } from '../services/dbService';
import { Inspiration } from '../types';

export const InspirationGallery: React.FC = () => {
  const [inspirations, setInspirations] = useState<Inspiration[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [lightboxImg, setLightboxImg] = useState<{src: string, title: string, prompt: string} | null>(null);

  useEffect(() => {
    const loadData = async () => {
      const data = await db.getAllInspirations();
      setInspirations(data);
    };
    loadData();
  }, []);

  const copyPrompt = (prompt: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    navigator.clipboard.writeText(prompt);
    // Add to app history if we had access to the context, or just simple alert
    alert('Prompt 已复制');
  };

  const filtered = inspirations.filter(i => 
    i.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    i.prompt.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
      {/* Header */}
      <header className="p-6 bg-white dark:bg-gray-800 shadow-md flex flex-col md:flex-row gap-4 items-center justify-between border-b border-gray-200 dark:border-gray-700 z-10">
          <div>
             <h1 className="text-2xl font-bold text-gray-900 dark:text-white">灵感图库</h1>
             <p className="text-xs text-gray-500 dark:text-gray-400">收藏优秀的生成结果与 Prompt</p>
          </div>
          
          <div className="w-full md:w-auto">
              <input 
                 type="text" 
                 placeholder="搜索标题或 Prompt..." 
                 className="w-full md:w-64 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-full px-4 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                 value={searchTerm}
                 onChange={e => setSearchTerm(e.target.value)}
              />
          </div>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6 pb-20">
         {filtered.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-600">
                 <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                 <p>暂无灵感图，请到“后台管理”添加</p>
             </div>
         ) : (
             <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                 {filtered.map(item => (
                     <div 
                        key={item.id} 
                        className="group bg-white dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:shadow-xl transition-all flex flex-col"
                     >
                         <div 
                            className="aspect-[2/3] md:aspect-square bg-gray-200 dark:bg-gray-900 relative overflow-hidden cursor-zoom-in"
                            onClick={() => setLightboxImg({src: item.imageUrl, title: item.title, prompt: item.prompt})}
                         >
                             <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                             
                             {/* Overlay */}
                             <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                 <button 
                                    onClick={(e) => copyPrompt(item.prompt, e)}
                                    className="px-4 py-2 bg-white/20 backdrop-blur-md border border-white/30 text-white rounded-full font-bold hover:bg-white/40 transition-colors flex items-center shadow-lg transform translate-y-4 group-hover:translate-y-0 duration-300"
                                 >
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                    复制 Prompt
                                 </button>
                             </div>
                         </div>
                         <div className="p-3">
                             <h3 className="font-bold text-gray-900 dark:text-white truncate" title={item.title}>{item.title}</h3>
                             <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 font-mono opacity-75">{item.prompt}</p>
                         </div>
                     </div>
                 ))}
             </div>
         )}
      </div>

      {/* Optimized Layout Lightbox */}
      {lightboxImg && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8" onClick={() => setLightboxImg(null)}>
              
              <div className="bg-white dark:bg-gray-900 w-full max-w-[90vw] h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col lg:flex-row border border-gray-700" onClick={e => e.stopPropagation()}>
                  
                  {/* Left: Image Area */}
                  <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative overflow-hidden group">
                      <img src={lightboxImg.src} alt={lightboxImg.title} className="max-w-full max-h-full object-contain shadow-lg" />
                  </div>

                  {/* Right: Info Sidebar */}
                  <div className="w-full lg:w-[480px] bg-white dark:bg-gray-900 flex flex-col border-l border-gray-200 dark:border-gray-800 h-1/2 lg:h-full">
                      <div className="p-6 flex-1 flex flex-col min-h-0">
                          {/* Header */}
                          <div className="flex justify-between items-start mb-6 flex-shrink-0">
                              <div>
                                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{lightboxImg.title}</h2>
                                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">NovelAI Generation</p>
                              </div>
                              <button onClick={() => setLightboxImg(null)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                          </div>

                          {/* Prompt Container - Flex Grow to fill space */}
                          <div className="flex flex-col flex-1 min-h-0">
                              <div className="flex justify-between items-center mb-2">
                                  <label className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Prompt</label>
                                  <span className="text-xs text-gray-400 font-mono">{lightboxImg.prompt.length} chars</span>
                              </div>
                              <div className="flex-1 bg-gray-50 dark:bg-gray-950 p-4 rounded-lg border border-gray-200 dark:border-gray-800 overflow-y-auto">
                                  <p className="text-sm font-mono text-gray-800 dark:text-gray-300 break-words whitespace-pre-wrap leading-relaxed select-text cursor-text">
                                      {lightboxImg.prompt}
                                  </p>
                              </div>
                          </div>
                          
                          {/* Footer Actions */}
                          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-3 flex-shrink-0">
                              <button 
                                onClick={() => copyPrompt(lightboxImg.prompt)} 
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg shadow-indigo-500/20 active:scale-[0.98] transition-all flex items-center justify-center"
                              >
                                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                  复制完整 Prompt
                              </button>
                              
                              <div className="flex gap-3">
                                <a 
                                    href={lightboxImg.src} 
                                    download={`${lightboxImg.title || 'nai-image'}.png`}
                                    className="flex-1 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium flex items-center justify-center transition-colors"
                                >
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    下载图片
                                </a>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};