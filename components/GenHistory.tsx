
import React, { useState, useEffect, useRef } from 'react';
import { localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import { LocalGenItem, User } from '../types';
import { PAGINATION_CONFIG } from '../config/pagination';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { ParamsViewer } from './ParamsViewer';
import {
    compressPngToJpg,
    isJpgDataUri,
} from '../services/imageCompression';

interface GenHistoryProps {
    currentUser: User;
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
    onRefreshInspiration?: () => void;
}

// --- 历史压缩相关常量 ---
/** JPG 质量默认值（与 ArtistAdmin "偏好设置" 共享） */
const DEFAULT_QUALITY = 0.85;
/** Lightbox 预览的 debounce 时长（毫秒） */
const PREVIEW_DEBOUNCE_MS = 400;
/** 平均耗时滑动窗口大小（用于"预计剩余 T 秒"估算） */
const TIMING_WINDOW = 10;

/** 从 LocalStorage 读取当前 JPG 质量；做边界保护 */
const readQuality = (): number => {
    const raw = localStorage.getItem('naipm.compaction.quality');
    if (!raw) return DEFAULT_QUALITY;
    const v = parseFloat(raw);
    if (isNaN(v)) return DEFAULT_QUALITY;
    return Math.min(1, Math.max(0.01, v));
};

/** 字节数 → MB 友好显示 */
const formatMB = (bytes: number): string => {
    if (bytes <= 0) return '0';
    const mb = bytes / (1024 * 1024);
    return mb < 0.01 ? mb.toFixed(3) : mb.toFixed(2);
};

export const GenHistory: React.FC<GenHistoryProps> = ({ currentUser, notify, onNavigateToPlayground, onRefreshInspiration }) => {
    const [items, setItems] = useState<LocalGenItem[]>([]);
    const [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishTitle, setPublishTitle] = useState('');
    const [showSuccessModal, setShowSuccessModal] = useState(false);

    // 分页相关状态
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    // 缓存管理
    const [pageCache, setPageCache] = useState<Record<number, LocalGenItem[]>>({});
    const pageCacheRef = useRef<Record<number, LocalGenItem[]>>({});
    const inflightPagesRef = useRef<Record<number, Promise<LocalGenItem[]>>>({});

    // 清理相关状态
    const [showCleanMenu, setShowCleanMenu] = useState(false);
    const [showCleanModal, setShowCleanModal] = useState(false);
    const [cleanMode, setCleanMode] = useState<'days' | 'count'>('days');
    const [cleanDays, setCleanDays] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_DAYS);
    const [cleanCount, setCleanCount] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_COUNT);
    const [cleanPreviewCount, setCleanPreviewCount] = useState(0);

    // --- 历史压缩状态 ---
    /** 库内待压缩 PNG 的数量（用于 disabled 判定） */
    const [pendingPngCount, setPendingPngCount] = useState(0);
    /** 批量压缩确认弹窗 */
    const [showCompactConfirm, setShowCompactConfirm] = useState(false);
    /** 批量压缩进度模态 */
    const [compactProgress, setCompactProgress] = useState<{
        total: number;
        processed: number;
        savedBytes: number;
        failed: number;
        remainingSec: number;
    } | null>(null);
    /** 批量压缩取消标志（ref 以便循环内同步读取） */
    const compactCancelRef = useRef<boolean>(false);
    /** 批量压缩完成摘要 */
    const [compactSummary, setCompactSummary] = useState<{
        success: number;
        failed: number;
        savedBytes: number;
        originalTotal: number;
    } | null>(null);

    // --- Lightbox 单张压缩状态 ---
    /** 实时预览的 JPG Data URI（仅 Lightbox 内、原图为 PNG 时使用） */
    const [previewJpgDataUri, setPreviewJpgDataUri] = useState<string | null>(null);
    /** Lightbox 滑块当前的 JPG 质量（独立 state，避免每次 keystroke 都写 LocalStorage） */
    const [lightboxQuality, setLightboxQuality] = useState<number>(() => readQuality());
    /** 当前正在生成预览 */
    const [previewing, setPreviewing] = useState(false);
    /** 并排预览的双列同步滚动容器 ref，监听 scroll 镜像 scrollTop/scrollLeft */
    const previewLeftRef = useRef<HTMLDivElement | null>(null);
    const previewRightRef = useRef<HTMLDivElement | null>(null);
    /** 同步 scroll 时的"内部触发"标记，防止 A→B→A 反向回弹无限循环 */
    const scrollSyncingRef = useRef<boolean>(false);
    /** 单张压缩进行中 */
    const [singleCompacting, setSingleCompacting] = useState(false);
    /** 预览 debounce timer */
    const previewTimerRef = useRef<number | null>(null);

    // --- 引导弹窗 ---
    const [showOnboarding, setShowOnboarding] = useState(false);

    // 初次挂载：加载第一页 + 检查是否需要引导
    useEffect(() => {
        goToPage(1);
        // 仅登录用户、未展示过 → 弹引导
        if (currentUser.role !== 'guest' && localStorage.getItem('naipm.compaction.onboarded') !== 'true') {
            setShowOnboarding(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ESC 关闭引导弹窗（任意关闭语义都等于"暂不启用 + 标记已展示"）
    useEffect(() => {
        if (!showOnboarding) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') dismissOnboarding(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showOnboarding]);

    const { PAGE_SIZE } = PAGINATION_CONFIG;

    const setCacheState = (nextCache: Record<number, LocalGenItem[]>) => {
        pageCacheRef.current = nextCache;
        setPageCache(nextCache);
    };

    const trimCacheAroundPage = (centerPage: number, totalPages: number, extraPages: Record<number, LocalGenItem[]> = {}) => {
        const validPages = [centerPage - 1, centerPage, centerPage + 1].filter(page => page >= 1 && page <= totalPages);
        const nextCache: Record<number, LocalGenItem[]> = {};

        validPages.forEach(page => {
            const data = extraPages[page] ?? pageCacheRef.current[page];
            if (data) {
                nextCache[page] = data;
            }
        });

        setCacheState(nextCache);
    };

    // 获取页面数据（优先从缓存）
    const getPageData = async (page: number): Promise<LocalGenItem[]> => {
        const cached = pageCacheRef.current[page];
        if (cached) {
            return cached;
        }

        const inflight = inflightPagesRef.current[page];
        if (inflight) {
            return inflight;
        }

        const request = localHistory.getPage(page - 1, PAGE_SIZE)
            .then(data => {
                delete inflightPagesRef.current[page];
                return data;
            })
            .catch(error => {
                delete inflightPagesRef.current[page];
                throw error;
            });

        inflightPagesRef.current[page] = request;
        return request;
    };

    const preloadPage = async (page: number, totalPages: number) => {
        if (page < 1 || page > totalPages) {
            return;
        }

        try {
            const data = await getPageData(page);

            if (!pageCacheRef.current[page]) {
                const nextCache = {
                    ...pageCacheRef.current,
                    [page]: data,
                };
                setCacheState(nextCache);
                trimCacheAroundPage(currentPage, totalPages, nextCache);
            }
        } catch (e) {
            console.warn('预加载页面失败:', e);
        }
    };

    /**
     * 扫描全库统计未压缩 PNG 数量。
     * 用于"压缩 PNG..."按钮的 disabled 判定。本地数据，O(n) 但 n 一般 ≤ 几千条可接受。
     */
    const refreshPendingPngCount = async () => {
        try {
            const all = await localHistory.getAll();
            const pending = all.filter(it => !isJpgDataUri(it.imageUrl)).length;
            setPendingPngCount(pending);
        } catch (e) {
            console.warn('统计未压缩 PNG 数量失败:', e);
        }
    };

    // 跳转到指定页
    const goToPage = async (page: number, force: boolean = false) => {
        if (isLoading) return;

        // 计算总页数
        const count = await localHistory.getCount();
        const calculatedTotalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

        // 边界检查
        const targetPage = Math.max(1, Math.min(page, calculatedTotalPages));

        // 如果不是强制刷新，且目标页与当前页相同，则跳过
        if (!force && targetPage === currentPage && items.length > 0) return;

        setIsLoading(true);
        setCurrentPage(targetPage);
        setTotalPages(calculatedTotalPages);
        setTotalCount(count);

        try {
            // 获取页面数据
            const data = await getPageData(targetPage);
            setItems(data);

            // 更新缓存并清理
            const nextCache = {
                ...pageCacheRef.current,
                [targetPage]: data,
            };
            setCacheState(nextCache);
            trimCacheAroundPage(targetPage, calculatedTotalPages, nextCache);

            // 预加载相邻页面（当前页 +1 和 -1）
            if (targetPage > 1) {
                void preloadPage(targetPage - 1, calculatedTotalPages);
            }
            if (targetPage < calculatedTotalPages) {
                void preloadPage(targetPage + 1, calculatedTotalPages);
            }

            // 同时更新待压缩 PNG 计数（用于按钮 disabled 判定）
            void refreshPendingPngCount();

        } catch (e) {
            console.error('加载页面失败:', e);
            notify('加载失败，请重试', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // 生成页码按钮
    const getPageButtons = (): number[] => {
        const buttons: number[] = [];
        const maxButtons = 7; // 最多显示7个页码按钮

        if (totalPages <= maxButtons) {
            // 总页数较少，显示所有页码
            for (let i = 1; i <= totalPages; i++) {
                buttons.push(i);
            }
        } else {
            // 总页数较多，显示当前页附近的页码
            const start = Math.max(1, currentPage - 3);
            const end = Math.min(totalPages, start + maxButtons - 1);

            for (let i = start; i <= end; i++) {
                buttons.push(i);
            }
        }

        return buttons;
    };

    /**
     * 根据 Lightbox 当前图片的 Data URI 前缀生成下载文件名。
     *
     * 历史压缩为 JPG 后下载扩展名也要对应改变 —— 见 ADR-0001。
     */
    const getDownloadFilename = (imageUrl?: string) => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const ext = imageUrl && isJpgDataUri(imageUrl) ? 'jpg' : 'png';
        return `NAI-${timestamp}.${ext}`;
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('确定删除这张图片记录吗？(无法恢复)')) {
            await localHistory.delete(id);
            if (lightbox?.id === id) setLightbox(null);
            // 清空缓存并强制刷新当前页
            setCacheState({});
            await goToPage(currentPage, true);
        }
    };

    const handleClearAll = async () => {
        if (confirm('确定清空所有本地生图历史吗？')) {
            await localHistory.clear();
            setItems([]);
            setTotalCount(0);
            setShowCleanMenu(false);
            setPendingPngCount(0);
        }
    };

    const handleCleanMenuClick = (mode: 'days' | 'count') => {
        setCleanMode(mode);
        setShowCleanMenu(false);
        setShowCleanModal(true);

        // 预览将删除的数量
        if (mode === 'days') {
            localHistory.countOlderThan(cleanDays).then(setCleanPreviewCount);
        } else {
            localHistory.getCount().then(count => {
                setCleanPreviewCount(Math.max(0, count - cleanCount));
            });
        }
    };

    const handleCleanConfirm = async () => {
        try {
            if (cleanMode === 'days') {
                await localHistory.deleteOlderThan(cleanDays);
            } else {
                await localHistory.keepOnly(cleanCount);
            }
            setShowCleanModal(false);
            // 清空缓存，强制刷新页面数据和总数
            setCacheState({});
            await goToPage(1, true); // 强制重新加载第一页，刷新总数
            notify('清理完成');
        } catch (e: any) {
            notify('清理失败: ' + e.message, 'error');
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
                params: lightbox.params,
                userId: currentUser.id,
                username: currentUser.username,
                createdAt: Date.now()
            });
            notify('发布成功！已加入灵感图库');
            setIsPublishing(false);
            setPublishTitle('');
            setLightbox(null);
            setShowSuccessModal(true);
            onRefreshInspiration?.();
        } catch (e: any) {
            notify('发布失败: ' + e.message, 'error');
            setIsPublishing(false);
        }
    };

    // --- 引导弹窗：关闭语义统一 ---
    /**
     * 关闭引导弹窗：无论"启用"还是"暂不启用 / X / ESC / 遮罩"都写 onboarded='true'。
     * @param enable true=同时打开"自动 JPG 保存"开关；false=仅标记已展示
     */
    const dismissOnboarding = (enable: boolean) => {
        localStorage.setItem('naipm.compaction.onboarded', 'true');
        if (enable) {
            localStorage.setItem('naipm.compaction.autoJpg', 'true');
            notify('已开启"自动 JPG 保存"');
        }
        setShowOnboarding(false);
    };

    // --- 批量压缩主流程 ---
    const handleStartBatchCompact = () => {
        setShowCleanMenu(false);
        if (pendingPngCount === 0) return; // 二次保险
        setShowCompactConfirm(true);
    };

    const handleConfirmBatchCompact = async () => {
        setShowCompactConfirm(false);
        const quality = readQuality();

        // 拉全库做主循环。批量压缩与分页解耦：直接走 getAll 一遍。
        const all = await localHistory.getAll();
        const total = all.length;
        compactCancelRef.current = false;
        const timings: number[] = [];
        let processed = 0;
        let savedBytes = 0;
        let originalTotal = 0;
        let failed = 0;
        let success = 0;

        setCompactProgress({ total, processed: 0, savedBytes: 0, failed: 0, remainingSec: 0 });

        for (const item of all) {
            if (compactCancelRef.current) break;

            // 幂等：已是 JPG 跳过；processed 仍 +1 让用户感知"扫过了"
            if (isJpgDataUri(item.imageUrl)) {
                processed++;
                setCompactProgress({ total, processed, savedBytes, failed, remainingSec: computeRemaining(timings, total, processed) });
                continue;
            }

            const start = performance.now();
            try {
                const { jpgDataUri, originalBytes, compressedBytes } = await compressPngToJpg(item.imageUrl, quality);
                await localHistory.updateImage(item.id, jpgDataUri);
                const saved = Math.max(0, originalBytes - compressedBytes);
                savedBytes += saved;
                originalTotal += originalBytes;
                success++;
                timings.push(performance.now() - start);
                if (timings.length > TIMING_WINDOW) timings.shift();
            } catch (e) {
                console.warn('压缩失败 id=' + item.id, e);
                failed++;
            }

            processed++;
            setCompactProgress({ total, processed, savedBytes, failed, remainingSec: computeRemaining(timings, total, processed) });
            // 让出主线程，避免锁死 UI
            await new Promise(r => setTimeout(r, 0));
        }

        // 完成 / 取消都进摘要
        setCompactProgress(null);
        setCompactSummary({ success, failed, savedBytes, originalTotal });
        compactCancelRef.current = false;

        // 刷新当前页和待压缩计数
        setCacheState({});
        await goToPage(currentPage, true);
    };

    const computeRemaining = (timings: number[], total: number, processed: number): number => {
        if (timings.length === 0) return 0;
        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        const remainingMs = avg * (total - processed);
        return Math.max(0, Math.round(remainingMs / 1000));
    };

    const handleCancelBatchCompact = () => {
        compactCancelRef.current = true;
    };

    // --- Lightbox 单张压缩 ---
    /** Lightbox 打开 / 切图时，重置预览相关状态 */
    useEffect(() => {
        // 清掉旧 timer / 预览
        if (previewTimerRef.current) {
            window.clearTimeout(previewTimerRef.current);
            previewTimerRef.current = null;
        }
        setPreviewJpgDataUri(null);
        setPreviewing(false);
        setLightboxQuality(readQuality());
    }, [lightbox?.id]);

    /**
     * 双列同步滚动：当并排预览开启时，监听任一容器的 scroll 事件，
     * 把 scrollTop/scrollLeft 镜像到另一侧。
     *
     * 关键防回弹：A 触发 onScroll 后我们写 B.scrollTop = A.scrollTop，
     * 这又会让 B 的 onScroll 触发；用 scrollSyncingRef 标记"这是内部回写"，
     * 让对侧 listener 直接 return，避免无限循环。
     */
    useEffect(() => {
        const left = previewLeftRef.current;
        const right = previewRightRef.current;
        // 双方都挂载且并排预览正在显示
        if (!left || !right || !previewJpgDataUri || lightboxIsJpg) return;

        const sync = (source: HTMLDivElement, target: HTMLDivElement) => {
            if (scrollSyncingRef.current) {
                scrollSyncingRef.current = false;
                return;
            }
            scrollSyncingRef.current = true;
            target.scrollTop = source.scrollTop;
            target.scrollLeft = source.scrollLeft;
        };

        const onLeft = () => sync(left, right);
        const onRight = () => sync(right, left);
        left.addEventListener('scroll', onLeft, { passive: true });
        right.addEventListener('scroll', onRight, { passive: true });
        return () => {
            left.removeEventListener('scroll', onLeft);
            right.removeEventListener('scroll', onRight);
        };
        // 依赖 previewJpgDataUri：预览首次出现 / 切换图片时重新挂载 listener
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewJpgDataUri, lightbox?.id]);

    /** 触发软实时预览（debounce） */
    const schedulePreview = (quality: number) => {
        if (!lightbox || isJpgDataUri(lightbox.imageUrl)) return;
        if (previewTimerRef.current) {
            window.clearTimeout(previewTimerRef.current);
        }
        previewTimerRef.current = window.setTimeout(async () => {
            if (!lightbox) return;
            setPreviewing(true);
            try {
                const { jpgDataUri } = await compressPngToJpg(lightbox.imageUrl, quality);
                setPreviewJpgDataUri(jpgDataUri);
            } catch (e) {
                console.warn('预览生成失败:', e);
            } finally {
                setPreviewing(false);
            }
        }, PREVIEW_DEBOUNCE_MS);
    };

    const handleLightboxQualityChange = (v: number) => {
        const clamped = Math.min(1, Math.max(0.01, v));
        setLightboxQuality(clamped);
        schedulePreview(clamped);
    };

    /** 单张：把当前 Lightbox 的 PNG 就地替换为 JPG */
    const handleSingleCompact = async () => {
        if (!lightbox || isJpgDataUri(lightbox.imageUrl)) return;
        setSingleCompacting(true);
        try {
            const { jpgDataUri, originalBytes, compressedBytes } = await compressPngToJpg(lightbox.imageUrl, lightboxQuality);
            await localHistory.updateImage(lightbox.id, jpgDataUri);
            const savedKB = Math.max(0, (originalBytes - compressedBytes) / 1024);
            notify(`已压缩，节省 ${savedKB < 1024 ? savedKB.toFixed(0) + ' KB' : (savedKB / 1024).toFixed(2) + ' MB'}`);

            // Lightbox 内同步更新展示
            const updated: LocalGenItem = { ...lightbox, imageUrl: jpgDataUri };
            setLightbox(updated);
            setPreviewJpgDataUri(null);

            // 主网格同步：清空缓存并强制重载当前页
            setCacheState({});
            await goToPage(currentPage, true);
        } catch (e: any) {
            notify('压缩失败: ' + (e.message || e), 'error');
        } finally {
            setSingleCompacting(false);
        }
    };

    // 当前 Lightbox 图是否已经压缩过
    const lightboxIsJpg = lightbox ? isJpgDataUri(lightbox.imageUrl) : false;

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <header className="p-4 md:p-6 bg-white dark:bg-gray-800 shadow-md border-b border-gray-200 dark:border-gray-700 z-10 flex-shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">本地生图历史</h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400">仅存储在您的浏览器中</p>
                    </div>
                    <div className="flex gap-2 md:gap-3 items-center">
                        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">共 {totalCount} 张</div>
                        <div className="relative">
                            <button
                                onClick={() => setShowCleanMenu(!showCleanMenu)}
                                className="px-3 py-1 md:px-4 md:py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs md:text-sm hover:bg-red-200 dark:hover:bg-red-900/50 flex items-center gap-1"
                            >
                                清理
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showCleanMenu && (
                                <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                                    <button
                                        onClick={handleClearAll}
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                                    >
                                        🗑️ 清空全部
                                    </button>
                                    <button
                                        onClick={() => handleCleanMenuClick('days')}
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        ⏰ 删除 X 天前的...
                                    </button>
                                    <button
                                        onClick={() => handleCleanMenuClick('count')}
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        📊 只保留最近 N 张...
                                    </button>
                                    {/* 压缩 PNG —— 移动端走菜单，桌面端也可在此点击 */}
                                    <button
                                        onClick={pendingPngCount === 0 ? undefined : handleStartBatchCompact}
                                        disabled={pendingPngCount === 0}
                                        title={pendingPngCount === 0 ? '无需压缩' : `压缩 ${pendingPngCount} 张 PNG 为 JPG`}
                                        className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 rounded-b-lg border-t border-gray-100 dark:border-gray-700 ${
                                            pendingPngCount === 0
                                                ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                                : 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20'
                                        }`}
                                    >
                                        📦 压缩 PNG... {pendingPngCount > 0 && <span className="text-[10px] opacity-70">（{pendingPngCount} 张）</span>}
                                    </button>
                                </div>
                            )}
                        </div>
                        {/* 桌面端独立压缩按钮，绿色系；移动端隐藏，走清理菜单内项 */}
                        <button
                            onClick={pendingPngCount === 0 ? undefined : handleStartBatchCompact}
                            disabled={pendingPngCount === 0}
                            title={pendingPngCount === 0 ? '无需压缩' : `压缩 ${pendingPngCount} 张 PNG 为 JPG`}
                            className={`hidden md:flex px-3 py-1 md:px-4 md:py-2 rounded text-xs md:text-sm items-center gap-1 transition-colors ${
                                pendingPngCount === 0
                                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                    : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50'
                            }`}
                        >
                            📦 压缩
                            {pendingPngCount > 0 && <span className="text-[10px] opacity-70">{pendingPngCount}</span>}
                        </button>
                        <button onClick={() => goToPage(currentPage)} className="px-3 py-1 md:px-4 md:py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs md:text-sm hover:bg-gray-200 dark:hover:bg-gray-600">
                            刷新
                        </button>
                    </div>
                </div>

                {/* 分页控件 */}
                {totalCount > 0 && (
                    <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        {/* 分页按钮 */}
                        <div className="flex items-center gap-2">
                            {/* 首页 */}
                            <button
                                onClick={() => goToPage(1)}
                                disabled={currentPage === 1 || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                首页
                            </button>

                            {/* 上一页 */}
                            <button
                                onClick={() => goToPage(currentPage - 1)}
                                disabled={currentPage === 1 || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                上一页
                            </button>

                            {/* 页码按钮 */}
                            <div className="flex gap-1">
                                {getPageButtons().map(page => (
                                    <button
                                        key={page}
                                        onClick={() => goToPage(page)}
                                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                                            page === currentPage
                                                ? 'bg-indigo-500 text-white border-indigo-500'
                                                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        {page}
                                    </button>
                                ))}
                            </div>

                            {/* 下一页 */}
                            <button
                                onClick={() => goToPage(currentPage + 1)}
                                disabled={currentPage === totalPages || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                下一页
                            </button>

                            {/* 末页 */}
                            <button
                                onClick={() => goToPage(totalPages)}
                                disabled={currentPage === totalPages || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                末页
                            </button>
                        </div>

                        {/* 页码输入框 */}
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600 dark:text-gray-300">跳至</span>
                            <input
                                type="number"
                                min="1"
                                max={totalPages}
                                placeholder="页码"
                                className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const page = parseInt((e.target as HTMLInputElement).value);
                                        if (page >= 1 && page <= totalPages) {
                                            goToPage(page);
                                        }
                                    }
                                }}
                            />
                            <button
                                onClick={() => {
                                    const input = document.querySelector('input[placeholder="页码"]') as HTMLInputElement;
                                    const page = parseInt(input.value);
                                    if (page >= 1 && page <= totalPages) {
                                        goToPage(page);
                                    }
                                }}
                                className="px-2 py-1 text-xs bg-indigo-500 text-white rounded hover:bg-indigo-600 transition-colors"
                            >
                                跳转
                            </button>
                        </div>
                    </div>
                )}
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20">
                {isLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="text-4xl mb-2 animate-spin">⏳</div>
                        <p>加载中...</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="text-4xl mb-2">🕰️</div>
                        <p>暂无生成记录</p>
                        <p className="text-sm mt-2">在 Chain 编辑器中生成图片会自动保存到这里</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                            {items.map(item => (
                                <div
                                    key={item.id}
                                    className="group relative aspect-square bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-indigo-500 transition-colors"
                                    onClick={() => setLightbox(item)}
                                >
                                    <img src={item.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                    {/* 已压缩 JPG 角标 */}
                                    {isJpgDataUri(item.imageUrl) && (
                                        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-emerald-500/90 text-white text-[9px] rounded font-bold tracking-wider">JPG</div>
                                    )}
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

                        {/* 底部分页信息 */}
                        <div className="flex flex-col items-center justify-center py-6">
                            {isLoading ? (
                                <div className="text-gray-500 dark:text-gray-400">⏳ 加载中...</div>
                            ) : (
                                <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
                                    <p>当前显示第 {Math.min((currentPage - 1) * PAGE_SIZE + 1, totalCount)} - {Math.min(currentPage * PAGE_SIZE, totalCount)} 张</p>
                                    <p className="mt-1">共 {totalCount} 张，已缓存 {Object.keys(pageCache).length} 页</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Lightbox */}
            {lightbox && (
                <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8" onClick={() => setLightbox(null)}>
                    <div className="bg-white dark:bg-gray-900 w-full max-w-6xl h-[85vh] md:h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                        {/* Image Area —— 原图 / 并排预览二选一 */}
                        <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative h-[45%] md:h-auto border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 overflow-hidden">
                            {previewJpgDataUri && !lightboxIsJpg ? (
                                // 并排预览：左 PNG 原图，右 JPG 预览
                                // 100% 原尺寸 + 双列同步滚动，看贴边/眼睛/纹理的真实差异
                                <div className="w-full h-full flex flex-col md:flex-row gap-2">
                                    {/* 左：PNG 原图 */}
                                    <div
                                        ref={previewLeftRef}
                                        className="flex-1 min-h-0 overflow-auto bg-white/40 dark:bg-black/40 rounded relative"
                                    >
                                        <div className="sticky top-0 left-0 z-10 px-2 py-1 bg-gray-900/70 text-white text-[10px] uppercase tracking-wider w-full backdrop-blur-sm">
                                            原图 PNG（100%）
                                        </div>
                                        <img src={lightbox.imageUrl} className="block max-w-none h-auto shadow-lg" />
                                    </div>
                                    {/* 右：JPG 预览 */}
                                    <div
                                        ref={previewRightRef}
                                        className="flex-1 min-h-0 overflow-auto bg-white/40 dark:bg-black/40 rounded relative"
                                    >
                                        <div className="sticky top-0 left-0 z-10 px-2 py-1 bg-emerald-600/80 text-white text-[10px] uppercase tracking-wider w-full backdrop-blur-sm">
                                            预览 JPG q={lightboxQuality.toFixed(2)}（100%）
                                        </div>
                                        <img src={previewJpgDataUri} className="block max-w-none h-auto shadow-lg" />
                                    </div>
                                </div>
                            ) : (
                                <img src={lightbox.imageUrl} className="max-w-full max-h-full object-contain shadow-lg" />
                            )}
                            {previewing && (
                                <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 text-white text-[10px] rounded">生成预览中...</div>
                            )}
                            {/* 并排预览模式下，左下角提示用户可以滚动查看细节 */}
                            {previewJpgDataUri && !lightboxIsJpg && (
                                <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white text-[10px] rounded pointer-events-none">
                                    💡 双列已同步滚动，拖动查看贴边 / 眼睛 / 纹理细节
                                </div>
                            )}
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
                                <ParamsViewer
                                    params={lightbox.params}
                                    prompt={lightbox.prompt}
                                    notify={notify}
                                />

                                {/* 历史压缩区块 */}
                                {lightboxIsJpg ? (
                                    // 已是 JPG：显示已压缩标签 + 跨工具元数据丢失提示
                                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="px-1.5 py-0.5 bg-emerald-500 text-white text-[9px] rounded font-bold tracking-wider">JPG</span>
                                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">此图已压缩</span>
                                        </div>
                                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                                            下载后无法在外部工具中读取生成参数（应用内仍可查看上方的 Prompt / Params）。
                                        </p>
                                    </div>
                                ) : (
                                    // 未压缩 PNG：显示 JPG 质量滑块 + 压缩按钮
                                    <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-bold text-gray-700 dark:text-gray-200">压缩为 JPG</label>
                                            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">{lightboxQuality.toFixed(2)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="1"
                                            step="0.01"
                                            value={lightboxQuality}
                                            onChange={e => handleLightboxQualityChange(parseFloat(e.target.value))}
                                            className="w-full accent-emerald-500 mb-2"
                                        />
                                        <button
                                            onClick={handleSingleCompact}
                                            disabled={singleCompacting}
                                            className="w-full py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded text-sm font-bold hover:bg-emerald-200 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-colors"
                                        >
                                            {singleCompacting ? '压缩中...' : '压缩此图'}
                                        </button>
                                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                                            原 PNG 将被替换为 JPG；下载后无法在外部工具读取生成参数。
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4 space-y-3 flex-shrink-0">
                                {/* 导入到编辑器 */}
                                <button
                                    onClick={() => {
                                        // 将完整参数存入 sessionStorage
                                        const importData = {
                                            prompt: lightbox.prompt,
                                            negativePrompt: '', // 历史记录中负面词已融合在 params 里
                                            params: lightbox.params,
                                        };
                                        sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(importData));
                                        setLightbox(null);
                                        notify('参数已准备就绪，正在跳转到编辑器...');
                                        onNavigateToPlayground?.();
                                    }}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    导入到编辑器
                                </button>

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
                                    download={getDownloadFilename(lightbox.imageUrl)}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-800 hover:bg-gray-700 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-sm font-bold transition-colors shadow-lg"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                    下载{lightboxIsJpg ? ' JPG' : '原图'}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* Clean Modal */}
            {showCleanModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">⚠️ 确认清理</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            {cleanMode === 'days'
                                ? `将删除 ${cleanDays} 天前的 ${cleanPreviewCount} 张图片`
                                : `当前共 ${totalCount} 张，将删除 ${cleanPreviewCount} 张，只保留最近 ${cleanCount} 张`
                            }
                        </p>
                        <p className="text-xs text-red-500 mb-4">此操作无法恢复</p>

                        <div className="mb-4">
                            {cleanMode === 'days' ? (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">天数</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanDays}
                                        onChange={e => {
                                            setCleanDays(Number(e.target.value));
                                            localHistory.countOlderThan(Number(e.target.value)).then(setCleanPreviewCount);
                                        }}
                                        className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">保留数量</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanCount}
                                        onChange={e => {
                                            setCleanCount(Number(e.target.value));
                                            localHistory.getCount().then(count => {
                                                setCleanPreviewCount(Math.max(0, count - Number(e.target.value)));
                                            });
                                        }}
                                        className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowCleanModal(false)}
                                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg font-bold"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCleanConfirm}
                                className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {showSuccessModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center animate-bounce-in">
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-full flex items-center justify-center text-3xl mb-4">
                            ✨
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">发布成功！</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            您的作品已添加到灵感图库，其他用户可以查看并引用您的 Prompt。
                        </p>
                        <button
                            onClick={() => setShowSuccessModal(false)}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-all"
                        >
                            确定
                        </button>
                    </div>
                </div>
            )}

            {/* --- 引导弹窗（仅登录用户首次切到历史页时弹一次） --- */}
            {showOnboarding && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                    onClick={() => dismissOnboarding(false)}
                >
                    <div
                        className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-2xl relative"
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            onClick={() => dismissOnboarding(false)}
                            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-full"
                            aria-label="关闭"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <div className="w-14 h-14 mx-auto mb-4 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center text-3xl">
                            📦
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">体积太大？试试自动 JPG 保存</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 leading-relaxed text-center">
                            开启后，新生成的图片在保存到本地前会先转码为 JPG（默认质量 0.85），通常能节省 50%–80% 空间。
                            应用内仍可查看完整的 Prompt 与生成参数。
                        </p>
                        {/* 提示用户也可以在任意历史图详情里调质量看预览，降低"启用"的心理门槛 */}
                        <div className="flex items-start gap-2 mb-5 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                            <span className="text-amber-500 dark:text-amber-400 text-sm leading-tight">💡</span>
                            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                                想先看效果？点开任意一张历史图的详情，拖动 <strong>JPG 质量</strong> 滑块就能并排预览压缩前后的真实差异。
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => dismissOnboarding(false)}
                                className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                                暂不启用
                            </button>
                            <button
                                onClick={() => dismissOnboarding(true)}
                                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg font-bold transition-colors shadow-lg"
                            >
                                启用
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- 批量压缩确认弹窗 --- */}
            {showCompactConfirm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">📦 确认批量压缩</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
                            即将把 <strong className="text-emerald-600 dark:text-emerald-400">{pendingPngCount}</strong> 张未压缩的 PNG 重编码为 JPG，
                            质量 <strong>{readQuality().toFixed(2)}</strong>。已是 JPG 的项会自动跳过。
                        </p>
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-4">
                            ⚠️ 压缩后的图片在外部工具中无法读取生成参数（本应用内不受影响）。
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowCompactConfirm(false)}
                                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg font-bold"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleConfirmBatchCompact}
                                className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg font-bold"
                            >
                                开始压缩
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- 批量压缩进度模态 --- */}
            {compactProgress && (
                <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">📦 正在压缩...</h3>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden mb-3">
                            <div
                                className="h-full bg-emerald-500 transition-all duration-200"
                                style={{ width: `${compactProgress.total === 0 ? 0 : (compactProgress.processed / compactProgress.total) * 100}%` }}
                            />
                        </div>
                        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1 mb-4">
                            <div className="flex justify-between">
                                <span>已处理</span>
                                <span className="font-mono">{compactProgress.processed} / {compactProgress.total}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>节省空间</span>
                                <span className="font-mono text-emerald-600 dark:text-emerald-400">~{formatMB(compactProgress.savedBytes)} MB</span>
                            </div>
                            <div className="flex justify-between">
                                <span>失败</span>
                                <span className={`font-mono ${compactProgress.failed > 0 ? 'text-red-500' : 'text-gray-500'}`}>{compactProgress.failed} 张</span>
                            </div>
                            <div className="flex justify-between">
                                <span>预计剩余</span>
                                <span className="font-mono">{compactProgress.remainingSec}s</span>
                            </div>
                        </div>
                        <button
                            onClick={handleCancelBatchCompact}
                            disabled={compactCancelRef.current}
                            className="w-full py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-bold hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                        >
                            {compactCancelRef.current ? '正在停止...' : '取消（当前张完成后停止）'}
                        </button>
                    </div>
                </div>
            )}

            {/* --- 批量压缩完成摘要 --- */}
            {compactSummary && (
                <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                        <div className="w-14 h-14 mx-auto mb-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center text-3xl">
                            ✅
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4 text-center">压缩完成</h3>
                        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1 mb-4">
                            <div className="flex justify-between">
                                <span>成功</span>
                                <span className="font-mono text-emerald-600 dark:text-emerald-400">{compactSummary.success} 张</span>
                            </div>
                            <div className="flex justify-between">
                                <span>失败</span>
                                <span className={`font-mono ${compactSummary.failed > 0 ? 'text-red-500' : 'text-gray-500'}`}>{compactSummary.failed} 张</span>
                            </div>
                            <div className="flex justify-between">
                                <span>节省总量</span>
                                <span className="font-mono text-emerald-600 dark:text-emerald-400">~{formatMB(compactSummary.savedBytes)} MB</span>
                            </div>
                            <div className="flex justify-between">
                                <span>压缩率</span>
                                <span className="font-mono">
                                    {compactSummary.originalTotal > 0
                                        ? `${Math.round((compactSummary.savedBytes / compactSummary.originalTotal) * 100)}%`
                                        : '—'}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => setCompactSummary(null)}
                            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg font-bold transition-colors shadow-lg"
                        >
                            确定
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
