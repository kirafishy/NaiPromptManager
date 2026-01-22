
import React, { useState } from 'react';
import { PromptChain } from '../types';

interface ChainListProps {
  chains: PromptChain[];
  onCreate: (name: string, desc: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  isLoading: boolean;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ChainList: React.FC<ChainListProps> = ({ chains, onCreate, onSelect, onDelete, onRefresh, isLoading, notify }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreate(newName, newDesc);
    setIsModalOpen(false);
    setNewName('');
    setNewDesc('');
  };

  const copyFullPrompt = (chain: PromptChain, negative = false) => {
      if (negative) {
          navigator.clipboard.writeText(chain.negativePrompt);
          notify('负面提示词已复制');
          return;
      }

      // Concatenate Base + Active Modules
      let parts = [];
      if (chain.basePrompt) parts.push(chain.basePrompt);
      if (chain.modules) {
          chain.modules.forEach(m => {
              if (m.isActive) parts.push(m.content);
          });
      }
      
      // Cleanup text
      const full = parts.join(', ').replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');
      navigator.clipboard.writeText(full);
      notify('完整正面提示词已复制');
  };

  const filteredChains = chains.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4 md:p-8">
      <div className="max-w-[1920px] mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-6 md:mb-10 gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">我的画师串</h1>
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400">管理并迭代你的 NovelAI 提示词风格组合。</p>
          </div>
          <div className="flex flex-col md:flex-row gap-2 md:gap-4 w-full md:w-auto">
             <div className="flex gap-2 w-full md:w-auto">
                <button 
                    onClick={onRefresh} 
                    className={`p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors`}
                    title="刷新列表"
                >
                    <svg className={`w-6 h-6 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <input 
                    type="text" 
                    placeholder="搜索..." 
                    className="flex-1 md:w-64 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
             </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center md:justify-start"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              新建画师串
            </button>
          </div>
        </header>

        {filteredChains.length === 0 ? (
          <div className="text-center py-20 bg-gray-100 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-gray-500 text-lg mb-4">暂无数据</p>
            <button onClick={() => setIsModalOpen(true)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium">创建第一个画师串</button>
          </div>
        ) : (
          /* Grid Layout Adjustment: Single column for mobile, more columns for larger screens */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredChains.map((chain) => (
              <div key={chain.id} onClick={() => onSelect(chain.id)} className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-500/50 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col cursor-pointer relative">
                {/* Copy Buttons Overlay */}
                <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        onClick={(e) => { e.stopPropagation(); copyFullPrompt(chain, false); }} 
                        className="bg-white/90 dark:bg-black/70 backdrop-blur p-1.5 rounded-full shadow-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200"
                        title="复制完整正面词"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); copyFullPrompt(chain, true); }} 
                        className="bg-white/90 dark:bg-black/70 backdrop-blur p-1.5 rounded-full shadow-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-200"
                        title="复制负面词"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                    </button>
                </div>

                {/* Preview Image: Changed from cover to contain, added background */}
                <div 
                    className="aspect-square bg-gray-200 dark:bg-gray-900 relative border-b border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center"
                >
                    {chain.previewImage ? (
                        <div className="w-full h-full relative group/img">
                            <img 
                                src={chain.previewImage} 
                                alt={chain.name} 
                                className="w-full h-full object-contain" 
                            />
                        </div>
                    ) : (
                        <div className="text-gray-400 dark:text-gray-700">
                             <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </div>
                    )}
                </div>

                <div className="p-3 flex flex-col flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate pr-2 w-full" title={chain.name}>{chain.name}</h3>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mb-2 line-clamp-2 h-8 leading-tight">{chain.description || '暂无描述'}</p>
                  
                  <div className="mt-auto flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-700/50">
                     <div className="flex flex-col min-w-0 mr-2">
                        <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 truncate" title={chain.username}>
                            @{chain.username || 'Unknown'}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                            {new Date(chain.updatedAt).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                     </div>
                     <button
                      onClick={(e) => { e.stopPropagation(); if(confirm('确认删除?')) onDelete(chain.id); }}
                      className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Simple Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 md:p-8 w-full max-w-md border border-gray-200 dark:border-gray-700 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">新建画师串</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">名称</label>
                <input
                  type="text"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：日系人像风格"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">描述</label>
                <textarea
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="描述这个风格的用途..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">取消</button>
              <button onClick={handleCreate} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
