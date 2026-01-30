
import React, { useState, useEffect } from 'react';
import { localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import { LocalGenItem, User } from '../types';

interface GenHistoryProps {
    currentUser: User;
    notify: (msg: string, type?: 'success' | 'error') => void;
}

const UC_LABELS: Record<number, string> = {
    0: 'Heavy (0)',
    1: 'Light (1)',
    2: 'Furry (2)',
    3: 'Human (3)',
    4: 'None (4)'
};

const ParamItem = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className="bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-100 dark:border-gray-700/50">
        <div className="text-[10px] text-gray-400 uppercase font-bold text-ellipsis overflow-hidden mb-0.5">{label}</div>
        <div className="text-xs font-mono text-gray-800 dark:text-gray-200 font-medium truncate" title={String(value)}>{value}</div>
    </div>
);

export const GenHistory: React.FC<GenHistoryProps> = ({ currentUser, notify }) => {
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

    const getDownloadFilename = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `NAI-${timestamp}.png`;
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
            notify('请输入标题', 'error');
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
            notify('发布成功！已加入灵感图库');
            setIsPublishing(false);
            setPublishTitle('');
            // Optional: Close lightbox or stay
        } catch (e: any) {
            notify('发布失败: ' + e.message, 'error');
            setIsPublishing(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <header className="p-4 md:p-6 bg-white dark:bg-gray-800 shadow-md flex justify-between items-center border-b border-gray-200 dark:border-gray-700 z-10 flex-shrink-0">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">本地生图历史</h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400">仅存储在您的浏览器中</p>
                </div>
                <div className="flex gap-2 md:gap-3">
                    <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">共 {items.length} 张</div>
                    <button onClick={handleClearAll} className="px-3 py-1 md:px-4 md:py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs md:text-sm hover:bg-red-200 dark:hover:bg-red-900/50">清空</button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20">
                {items.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="text-4xl mb-2">🕰️</div>
                        <p>暂无生成记录</p>
                        <p className="text-sm mt-2">在 Chain 编辑器中生成图片会自动保存到这里</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                        {items.map(item => (
                            <div
                                key={item.id}
                                className="group relative aspect-square bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-indigo-500 transition-colors"
                                onClick={() => setLightbox(item)}
                            >
                                <img src={item.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                <div className="absolute top-2 right-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => handleDelete(item.id, e)} className="p-1.5 bg-red-500 text-white rounded-full shadow hover:bg-red-600">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity truncate">
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
                    <div className="bg-white dark:bg-gray-900 w-full max-w-6xl h-[85vh] md:h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                        {/* Image Area */}
                        <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative h-[45%] md:h-auto border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800">
                            <img src={lightbox.imageUrl} className="max-w-full max-h-full object-contain shadow-lg" />
                        </div>

                        {/* Details Area */}
                        <div className="w-full md:w-[400px] bg-white dark:bg-gray-900 flex flex-col p-4 md:p-6 h-[55%] md:h-auto overflow-hidden">
                            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">图片详情</h2>
                                <button onClick={() => setLightbox(null)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                                {/* Prompt Section */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                                            Prompt
                                        </label>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(lightbox.prompt); notify('Prompt 已复制'); }}
                                            className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                                        >
                                            复制
                                        </button>
                                    </div>
                                    <div className="text-xs text-gray-700 dark:text-gray-300 font-mono break-words bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 p-3 rounded-lg leading-relaxed select-text">
                                        {lightbox.prompt}
                                    </div>
                                </div>

                                {/* Parameters Grid */}
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                                        Parameters
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <ParamItem label="Resolution" value={`${lightbox.params.width} × ${lightbox.params.height}`} />
                                        <ParamItem label="Steps" value={lightbox.params.steps} />
                                        <ParamItem label="Scale" value={lightbox.params.scale} />
                                        <ParamItem label="Sampler" value={lightbox.params.sampler.replace(/_/g, ' ')} />
                                        <ParamItem label="Seed" value={lightbox.params.seed ?? 'Random'} />
                                        <ParamItem label="Quality Tags" value={lightbox.params.qualityToggle ? 'On' : 'Off'} />
                                        <ParamItem label="UC Preset" value={lightbox.params.ucPreset !== undefined ? UC_LABELS[lightbox.params.ucPreset] ?? lightbox.params.ucPreset : '-'} />
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4 space-y-3 flex-shrink-0">
                                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                                    <label className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">发布到灵感图库</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="为这张图取个标题..."
                                            className="flex-1 px-3 py-2 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800 text-sm outline-none dark:text-white focus:border-indigo-500 transition-colors"
                                            value={publishTitle}
                                            onChange={e => setPublishTitle(e.target.value)}
                                        />
                                        <button
                                            onClick={handlePublish}
                                            disabled={isPublishing}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold whitespace-nowrap disabled:opacity-50 transition-colors shadow-sm"
                                        >
                                            {isPublishing ? '发布中' : '发布'}
                                        </button>
                                    </div>
                                </div>
                                <a
                                    href={lightbox.imageUrl}
                                    download={getDownloadFilename()}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-800 hover:bg-gray-700 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-sm font-bold transition-colors shadow-lg"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                    下载原图
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
