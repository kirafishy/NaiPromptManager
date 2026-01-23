
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Artist } from '../types';
import { generateImage } from '../services/naiService'; // Import generation service
import { api } from '../services/api'; // Import api for updating
import { db } from '../services/dbService'; // Import DB to fetch config

interface CartItem {
  name: string;
  weight: number; // 0 normal, >0 {}, <0 []
}

interface ArtistLibraryProps {
  isDark: boolean;
  toggleTheme: () => void;
  // New props for caching
  artistsData: Artist[] | null;
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

// Helper to get first char
const getGroupChar = (name: string) => {
    const char = name.charAt(0).toUpperCase();
    return /[A-Z]/.test(char) ? char : '#';
};

const ALPHABET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Lazy Loading Component
const LazyImage: React.FC<{ src: string; alt: string; className?: string }> = ({ src, alt, className }) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [isInView, setIsInView] = useState(false);
    const imgRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsLoaded(false); // Reset load state when src changes
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                setIsInView(true);
                observer.disconnect();
            }
        }, { threshold: 0.1 });

        if (imgRef.current) observer.observe(imgRef.current);
        return () => observer.disconnect();
    }, [src]);

    return (
        <div ref={imgRef} className={`relative bg-gray-200 dark:bg-gray-900 overflow-hidden ${className || 'w-full h-full'}`}>
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
                    <span className="animate-pulse">...</span>
                </div>
            )}
        </div>
    );
};

// --- Benchmark Config Interface ---
interface BenchmarkSlot {
    label: string;
    prompt: string;
}

interface BenchmarkConfig {
    slots: BenchmarkSlot[]; // Flexible slots
    negative: string;
    seed: number;
    steps: number;
    scale: number;
}

const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
    slots: [
        { 
            label: "面部", 
            prompt: "masterpiece, best quality, 1girl, solo,\ncowboy shot, slight tilt head, three-quarter view,\nhand on face, peace sign, index finger raised, (dynamic pose),\ndetailed face, detailed eyes, blushing, happy, open mouth,\nmessy hair, hair ornament,\nwhite shirt, collarbone,\nsimple background, soft lighting, " 
        },
        { 
            label: "体态", 
            prompt: "masterpiece, best quality, 1girl, solo,\nkneeling, from above, looking at viewer,\nbikini, wet skin, long hair, medium breasts, soft shading, clear form, (detailed anatomy:1.1), extremely detailed figure, \nstomach, navel, cleavage, collarbone, beautiful hands,\nthighs, barefoot,\nbeach, ocean, cinematic lighting, detailed characters, amazing quality, very aesthetic, absurdres, high detail, ultra-detailed," 
        },
        { 
            label: "场景", 
            prompt: "masterpiece, best quality, 1girl, solo,\nfull body, walking, looking back,\nfantasy clothes, cape, armor, holding sword,\nwind, hair blowing, petals,\nruins, forest, overgrown, detailed background, depth of field,\ndappled sunlight, atmospheric, intricate details," 
        }
    ],
    negative: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, censorbar, mosaic, censoring, bar censor, convenient censoring, bad anatomy, bad hands, text, error, missing fingers, crop,",
    seed: -1, // Random
    steps: 28,
    scale: 6
};

// Queue Item Interface
interface GenTask {
    uniqueId: string;
    artistId: string;
    slot: number;
}

interface LogEntry {
    time: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

export const ArtistLibrary: React.FC<ArtistLibraryProps> = ({ isDark, toggleTheme, artistsData, onRefresh, notify }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [usePrefix, setUsePrefix] = useState(true);
  const [lightboxImg, setLightboxImg] = useState<{src: string, name: string} | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // New State for features
  const [history, setHistory] = useState<{text: string, time: string}[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [gachaCount, setGachaCount] = useState(3);
  
  // Layout State
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid');
  // Grid Size Slider (px) - Default to ~160px (mobile friendly min)
  const [minGridSize, setMinGridSize] = useState(160);

  // Benchmark / Preview Mode State
  const [viewMode, setViewMode] = useState<'original' | 'benchmark'>('original');
  const [activeSlot, setActiveSlot] = useState<number>(0); // Index of config.slots
  
  // Benchmark Settings
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<BenchmarkConfig>(DEFAULT_BENCHMARK_CONFIG);
  
  // -- Config Editor State (Draft Mode) --
  const [draftConfig, setDraftConfig] = useState<BenchmarkConfig>(DEFAULT_BENCHMARK_CONFIG);
  const [slotToDelete, setSlotToDelete] = useState<number | null>(null); // For deletion confirmation

  const [apiKey, setApiKey] = useState('');

  // Queue System
  const [taskQueue, setTaskQueue] = useState<GenTask[]>([]);
  const [failedTasks, setFailedTasks] = useState<GenTask[]>([]); // New: Failed Queue
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false); 
  const [currentTask, setCurrentTask] = useState<GenTask | null>(null);
  
  // Logs System
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  // Load data & Config
  useEffect(() => {
    const savedFav = localStorage.getItem('nai_fav_artists');
    if (savedFav) setFavorites(new Set(JSON.parse(savedFav)));
    
    const savedPrefix = localStorage.getItem('nai_use_prefix');
    if (savedPrefix !== null) setUsePrefix(savedPrefix === 'true');

    const savedHistory = localStorage.getItem('nai_copy_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));

    // Load Config from Server (Public)
    db.getBenchmarkConfig().then(cfg => {
        if (cfg) setConfig(cfg);
    }).catch(err => {
        console.error("Failed to load benchmark config from server", err);
        // Fallback to local storage if server fails (backward compat)
        const savedConfig = localStorage.getItem('nai_benchmark_config');
        if (savedConfig) {
            try {
                const parsed = JSON.parse(savedConfig);
                if (!parsed.slots || parsed.slots.length === 0) parsed.slots = DEFAULT_BENCHMARK_CONFIG.slots;
                setConfig(parsed);
            } catch(e) {}
        }
    });

    const savedKey = localStorage.getItem('nai_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  const handleApiKeyChange = (val: string) => {
      setApiKey(val);
      localStorage.setItem('nai_api_key', val);
  };

  const handleRefresh = async () => {
      setIsLoading(true);
      await onRefresh();
      setIsLoading(false);
  };

  const addToHistory = (text: string) => {
    const newEntry = { text, time: new Date().toLocaleTimeString() };
    const newHistory = [newEntry, ...history.filter(h => h.text !== text)].slice(30);
    setHistory(newHistory);
    localStorage.setItem('nai_copy_history', JSON.stringify(newHistory));
  };

  const toggleFav = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newFav = new Set(favorites);
    if (newFav.has(name)) newFav.delete(name);
    else newFav.add(name);
    setFavorites(newFav);
    localStorage.setItem('nai_fav_artists', JSON.stringify(Array.from(newFav)));
  };

  const toggleCart = (name: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    if (cart.find(i => i.name === name)) {
      setCart(cart.filter(i => i.name !== name));
    } else {
      setCart([...cart, { name, weight: 0 }]);
    }
  };

  const updateWeight = (index: number, delta: number) => {
    const newCart = [...cart];
    let w = newCart[index].weight + delta;
    if (w > 3) w = 3;
    if (w < -3) w = -3;
    newCart[index].weight = w;
    setCart(newCart);
  };

  const formatTag = (item: CartItem) => {
    let s = (usePrefix ? 'artist:' : '') + item.name;
    if (item.weight > 0) s = "{".repeat(item.weight) + s + "}".repeat(item.weight);
    if (item.weight < 0) s = "[".repeat(Math.abs(item.weight)) + s + "]".repeat(Math.abs(item.weight));
    return s;
  };

  const copyCart = () => {
    const str = cart.map(formatTag).join(', ');
    navigator.clipboard.writeText(str);
    addToHistory(str);
    notify('组合串已复制！');
  };

  // MEMOIZED Filtered Artists to prevent stutter during layout changes
  const filteredArtists = useMemo(() => {
      return (artistsData || []).filter(a => {
        if (showFavOnly && !favorites.has(a.name)) return false;
        if (searchTerm) return a.name.toLowerCase().includes(searchTerm.toLowerCase());
        return true;
      });
  }, [artistsData, showFavOnly, favorites, searchTerm]);

  // --- New Features Logic ---
  
  const gacha = () => {
    if (!artistsData) return;
    const pool = showFavOnly ? artistsData.filter(a => favorites.has(a.name)) : artistsData;
    if (pool.length === 0) return;
    
    // Pick random count
    const count = Math.min(Math.max(1, gachaCount), 50);
    const newCart = [...cart];
    
    for (let i = 0; i < count; i++) {
        const randomArtist = pool[Math.floor(Math.random() * pool.length)];
        if (!newCart.find(c => c.name === randomArtist.name)) {
            newCart.push({ name: randomArtist.name, weight: 0 });
        }
    }
    setCart(newCart);
  };

  const handleImport = () => {
      const tags = importText.split(/[,，\n]/).map(s => s.trim()).filter(s => s);
      const newItems: CartItem[] = [];
      
      tags.forEach(raw => {
          let name = raw.replace(/^artist:/i, '');
          let weight = 0;
          
          // Simple brace counting
          const openBraces = (name.match(/\{/g) || []).length;
          const closeBraces = (name.match(/\}/g) || []).length;
          const openBrackets = (name.match(/\[/g) || []).length;
          const closeBrackets = (name.match(/\]/g) || []).length;
          
          if (openBraces > 0 && openBraces === closeBraces) {
              weight = openBraces;
              name = name.replace(/[\{\}]/g, '');
          } else if (openBrackets > 0 && openBrackets === closeBrackets) {
              weight = -openBrackets;
              name = name.replace(/[\[\]]/g, '');
          }
          
          // Match with known artists
          const matched = (artistsData || []).find(a => a.name.toLowerCase() === name.toLowerCase());
          if (matched) {
              // Avoid duplicates in batch
              if (!newItems.find(i => i.name === matched.name)) {
                 newItems.push({ name: matched.name, weight });
              }
          }
      });
      
      // Merge with cart
      const finalCart = [...cart];
      newItems.forEach(item => {
          if (!finalCart.find(c => c.name === item.name)) {
              finalCart.push(item);
          }
      });
      setCart(finalCart);
      setShowImport(false);
      setImportText('');
      notify(`已导入 ${newItems.length} 位画师`);
  };

  const scrollToLetter = (char: string) => {
    // Scroll within the container instead of window to avoid hiding toolbar
    const container = scrollContainerRef.current;
    if (!container) return;

    const el = document.getElementById(`anchor-${char}`);
    if (el) {
        // Calculate offset relative to container
        const topPos = el.offsetTop - container.offsetTop;
        container.scrollTo({ top: topPos, behavior: 'smooth' });
    }
  };

  // --- Config Modal Logic (Refactored to Draft Mode) ---
  
  const openConfig = () => {
      setDraftConfig(JSON.parse(JSON.stringify(config))); // Deep copy active config to draft
      setShowConfig(true);
  };

  const saveConfig = async () => {
      // Basic validation
      if (draftConfig.slots.length === 0) {
          notify('至少需要一个测试分组', 'error');
          return;
      }
      // Apply Draft to Real Config & Save to Server
      setConfig(draftConfig);
      
      try {
          await db.saveBenchmarkConfig(draftConfig);
          notify('配置已保存 (同步至云端)');
      } catch (e) {
          console.error(e);
          notify('保存失败，仅本地生效', 'error');
          localStorage.setItem('nai_benchmark_config', JSON.stringify(draftConfig)); // Fallback
      }
      
      // Safety: if active slot was deleted, reset to 0
      if (activeSlot >= draftConfig.slots.length) {
          setActiveSlot(0);
      }
      
      setShowConfig(false);
  };

  // Helper Functions operate on DRAFT config now
  const updateSlot = (index: number, field: keyof BenchmarkSlot, value: string) => {
      const newSlots = [...draftConfig.slots];
      newSlots[index] = { ...newSlots[index], [field]: value };
      setDraftConfig({ ...draftConfig, slots: newSlots });
  };

  const addSlot = () => {
      setDraftConfig({
          ...draftConfig,
          slots: [...draftConfig.slots, { label: `分组 ${draftConfig.slots.length + 1}`, prompt: "" }]
      });
  };

  // Trigger Confirmation instead of direct delete
  const handleDeleteClick = (index: number) => {
      setSlotToDelete(index);
  };

  // Actual Delete Logic
  const confirmDeleteSlot = () => {
      if (slotToDelete === null) return;
      const newSlots = draftConfig.slots.filter((_, i) => i !== slotToDelete);
      setDraftConfig({ ...draftConfig, slots: newSlots });
      setSlotToDelete(null); // Close confirmation
  };

  // Helper Log
  const addLog = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
      const entry: LogEntry = {
          time: new Date().toLocaleTimeString(),
          message: msg,
          type
      };
      setLogs(prev => [entry, ...prev].slice(0, 100)); // Keep last 100 logs
      console.log(`[Queue] ${msg}`);
  };

  // --- Queue Processor ---
  useEffect(() => {
      const processNext = async () => {
          // Check Pause state
          if (isProcessing || taskQueue.length === 0 || isPaused) return;
          
          // Delay to prevent 429 (Throttle)
          setIsProcessing(true);
          await new Promise(res => setTimeout(res, 5000)); // 5s safe delay

          const task = taskQueue[0];
          setCurrentTask(task);

          try {
              // Find the artist info
              const artist = artistsData?.find(a => a.id === task.artistId);
              if (!artist) {
                  throw new Error(`Artist ID ${task.artistId} not found`);
              }

              // Actual generation Logic
              const slot = config.slots[task.slot];
              if (!slot) throw new Error(`Slot config missing for index ${task.slot}`);

              const slotPrompt = slot.prompt;
              const prompt = `artist:${artist.name}, ${slotPrompt}`;
              const negative = config.negative;
              const seed = config.seed === -1 ? 0 : config.seed;

              const base64Img = await generateImage(apiKey, prompt, negative, {
                  width: 832, height: 1216, steps: config.steps, scale: config.scale, sampler: 'k_euler_ancestral', seed: seed,
                  qualityToggle: true, ucPreset: 0
              });

              // Construct update payload
              // Fetch FRESH benchmarks from current state to avoid overwrites if multiple tasks ran
              const currentBenchmarks = artist.benchmarks ? [...artist.benchmarks] : (artist.previewUrl ? [artist.previewUrl] : []);
              
              // Pad array if needed
              while(currentBenchmarks.length <= task.slot) currentBenchmarks.push("");
              currentBenchmarks[task.slot] = base64Img;

              await api.post('/artists', {
                  id: artist.id,
                  name: artist.name,
                  imageUrl: artist.imageUrl,
                  previewUrl: artist.previewUrl,
                  benchmarks: currentBenchmarks
              });

              // Refresh UI
              await onRefresh();
              addLog(`Generated: ${artist.name} (Slot ${task.slot + 1})`, 'success');

          } catch (err: any) {
              const errMsg = err.message || JSON.stringify(err);
              const is429 = errMsg.includes('429') || errMsg.includes('Concurrent') || errMsg.includes('locked');
              
              const artistName = artistsData?.find(a => a.id === task.artistId)?.name || 'Unknown';
              const logMsg = is429 
                ? `Rate Limit (429) for ${artistName}. Task moved to Retry Queue.` 
                : `Failed: ${artistName} - ${errMsg}`;
              
              addLog(logMsg, 'error');
              
              // Move to Failed Queue instead of discarding
              setFailedTasks(prev => [...prev, task]);
              
              if (!is429) {
                  notify(`生成失败: ${artistName}`, 'error');
              }
          } finally {
              // Remove done task and loop
              setTaskQueue(prev => prev.slice(1));
              setCurrentTask(null);
              setIsProcessing(false);
          }
      };

      processNext();
  }, [taskQueue, isProcessing, isPaused, apiKey, config, artistsData, onRefresh, notify]);


  // Add tasks to queue
  const queueGeneration = (artist: Artist, slots: number[], e: React.MouseEvent) => {
      e.stopPropagation();
      if (!apiKey) {
          notify('请先在设置中配置 API Key', 'error');
          openConfig(); // Use new opener
          return;
      }

      const newTasks = slots.map(s => ({
          uniqueId: crypto.randomUUID(),
          artistId: artist.id,
          slot: s
      }));

      setTaskQueue(prev => [...prev, ...newTasks]);
      notify(`已添加 ${newTasks.length} 个任务到队列`);
  };

  const retryFailedTasks = () => {
      if (failedTasks.length === 0) return;
      setTaskQueue(prev => [...prev, ...failedTasks]);
      setFailedTasks([]);
      addLog(`Retrying ${failedTasks.length} failed tasks`, 'info');
      notify(`已重新加入 ${failedTasks.length} 个失败任务`);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
      
      {/* --- Controls Header --- */}
      <div className="p-4 bg-white dark:bg-gray-800 shadow-md flex flex-col items-stretch gap-4 z-10 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        
        <div className="flex gap-2 w-full">
            <button 
                onClick={handleRefresh} 
                className={`p-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex-shrink-0`}
                title="刷新画师列表"
            >
                <svg className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>

            {/* Layout Toggle */}
            <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-1 border border-gray-200 dark:border-gray-700 flex-shrink-0">
                <button
                    onClick={() => setLayoutMode('grid')}
                    className={`p-1.5 rounded transition-all ${layoutMode === 'grid' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    title="网格视图"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                </button>
                <button
                    onClick={() => setLayoutMode('list')}
                    className={`p-1.5 rounded transition-all ${layoutMode === 'list' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    title="展开视图 (实装一览)"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                </button>
            </div>

            {/* Slider for Grid Size */}
            {layoutMode === 'grid' && (
                <div className="flex items-center gap-2 flex-1 md:flex-none md:w-32 px-2">
                    <span className="text-xs text-gray-400">🔍</span>
                    <input 
                        type="range" 
                        min="100" max="300" step="10"
                        value={minGridSize} 
                        onChange={(e) => setMinGridSize(parseInt(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                        title="调整图片大小"
                    />
                </div>
            )}

            {/* Search */}
            <div className="flex-1 relative">
                <input 
                    type="text" 
                    placeholder="搜索 / 粘贴 Prompt..." 
                    className="w-full pl-4 pr-10 py-2 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 transition-colors"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs border border-gray-300 dark:border-gray-600 px-1.5 rounded pointer-events-none">/</div>
            </div>
        </div>

        <div className="flex justify-between items-center flex-wrap gap-2">
            {/* View Toggle (Only show in Grid mode, or keep for general settings) */}
            {layoutMode === 'grid' && (
                <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-1 border border-gray-200 dark:border-gray-700">
                    <button
                        onClick={() => setViewMode('original')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all ${viewMode === 'original' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    >
                        原图
                    </button>
                    <button
                        onClick={() => setViewMode('benchmark')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${viewMode === 'benchmark' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    >
                        实装
                    </button>
                </div>
            )}

            {/* Config & Slots (Show Config button always, Slots only in Grid-Benchmark mode) */}
            <div className="flex items-center gap-2 overflow-x-auto max-w-full">
                <button 
                    onClick={openConfig} 
                    className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex-shrink-0"
                    title="配置分组"
                >
                    ⚙️
                </button>
                
                {layoutMode === 'grid' && viewMode === 'benchmark' && (
                    <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-1 border border-gray-200 dark:border-gray-700 overflow-x-auto max-w-[200px] md:max-w-none md:flex-wrap md:overflow-visible gap-1 items-center">
                        {config.slots.map((slot, index) => (
                            <button
                                key={index}
                                onClick={() => setActiveSlot(index)}
                                className={`px-3 py-1 rounded text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${activeSlot === index ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
                                title={slot.prompt}
                            >
                                {index + 1}. {slot.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Settings Group */}
            <div className="flex gap-2 items-center ml-auto">
                {/* Queue / Log Button */}
                {(taskQueue.length > 0 || failedTasks.length > 0 || logs.length > 0) && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded border cursor-pointer select-none transition-colors ${
                            failedTasks.length > 0 
                            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' 
                            : 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-100 dark:border-indigo-800'
                        }`}
                        onClick={() => setShowLogs(true)}
                        title="点击查看生成日志"
                    >
                         <span className={`text-xs font-mono ${failedTasks.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-300'}`}>
                             Wait:{taskQueue.length} {failedTasks.length > 0 && `| Fail:${failedTasks.length}`}
                         </span>
                         {/* Pause/Resume Button */}
                         <button 
                            onClick={(e) => { e.stopPropagation(); setIsPaused(!isPaused); }}
                            className={`w-5 h-5 flex items-center justify-center rounded hover:bg-white dark:hover:bg-black/20 ${isPaused ? 'text-yellow-600 animate-pulse' : 'text-indigo-600'}`}
                            title={isPaused ? "恢复队列" : "暂停队列"}
                         >
                             {isPaused ? (
                                 <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                             ) : (
                                 <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                             )}
                         </button>
                         {isProcessing && !isPaused && <div className="w-2 h-2 rounded-full bg-green-500 animate-ping"></div>}
                    </div>
                )}
                
                <button 
                    onClick={() => setShowImport(true)} 
                    title="批量导入"
                    className="h-8 px-3 rounded-full border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 font-bold flex items-center gap-2 transition-colors text-sm"
                >
                    📥
                </button>
                
                <button 
                    onClick={() => setShowHistory(!showHistory)} 
                    title="历史记录"
                    className="h-8 px-3 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center transition-colors text-sm"
                >
                    🕒
                </button>
                
                <button 
                    onClick={() => setShowFavOnly(!showFavOnly)} 
                    title="收藏"
                    className={`h-8 px-3 rounded-full border flex items-center transition-colors text-sm ${
                        showFavOnly 
                        ? 'bg-yellow-50 border-yellow-300 text-yellow-600 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-500' 
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-400'
                    }`}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>
                </button>
            </div>
        </div>
      </div>

      {/* --- A-Z Navigation Sidebar (Moved to LEFT) --- */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 z-20 hidden md:flex flex-col gap-0.5 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-r-lg p-1 shadow-lg border border-l-0 border-gray-200 dark:border-gray-700 max-h-[80%] overflow-y-auto no-scrollbar">
          {ALPHABET.map(char => (
              <button 
                key={char} 
                onClick={() => scrollToLetter(char)}
                className="text-[10px] w-5 h-5 flex items-center justify-center rounded hover:bg-indigo-100 dark:hover:bg-indigo-900 text-gray-500 dark:text-gray-400 font-bold"
              >
                  {char}
              </button>
          ))}
      </div>

      {/* --- Main Content Area --- */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 md:pl-14 pb-40 bg-gray-50 dark:bg-gray-900 scroll-smooth relative">
         {isLoading && (
             <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-gray-900/80 z-20">
                 <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
             </div>
         )}
         
         {layoutMode === 'grid' ? (
             /* --- GRID LAYOUT (Dynamic Columns using minmax) --- */
             <div 
                className="grid gap-2 md:gap-4 md:pr-6 transition-all" 
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minGridSize}px, 1fr))` }}
             > 
                 {filteredArtists.map((artist, idx) => {
                     const isSelected = !!cart.find(c => c.name === artist.name);
                     const isFav = favorites.has(artist.name);
                     
                     // Determine Group Header / Anchor
                     const prevChar = idx > 0 ? getGroupChar(filteredArtists[idx-1].name) : '';
                     const currChar = getGroupChar(artist.name);
                     const isAnchor = currChar !== prevChar;
                     
                     // Display Image Selection Logic
                     let displayImg = artist.imageUrl;
                     let isBenchmarkMissing = false;

                     if (viewMode === 'benchmark') {
                         if (artist.benchmarks && artist.benchmarks[activeSlot]) {
                             displayImg = artist.benchmarks[activeSlot];
                         } else if (activeSlot === 0 && artist.previewUrl) {
                             displayImg = artist.previewUrl;
                         } else {
                             isBenchmarkMissing = true;
                         }
                     }

                     // Task status
                     const isTaskPending = taskQueue.some(t => t.artistId === artist.id);
                     const isTaskRunning = currentTask?.artistId === artist.id;
                     const isTaskFailed = failedTasks.some(t => t.artistId === artist.id);
                     
                     return (
                         <div 
                            key={artist.id} 
                            id={isAnchor ? `anchor-${currChar}` : undefined}
                            className={`group relative bg-white dark:bg-gray-800 rounded-xl overflow-hidden border transition-all cursor-pointer shadow-sm hover:shadow-lg ${isSelected ? 'border-red-500 dark:border-red-500 ring-1 ring-red-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-500'}`}
                            onClick={() => toggleCart(artist.name)}
                         >
                             <div className="aspect-[2/3] relative overflow-hidden bg-gray-200 dark:bg-gray-900">
                                 {!isBenchmarkMissing ? (
                                    <LazyImage src={displayImg} alt={artist.name} />
                                 ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                                        <span className="text-2xl mb-1">🤖</span>
                                        <span className="text-[10px]">No Data</span>
                                    </div>
                                 )}
                                 
                                 {/* Task Status Overlay */}
                                 {(isTaskPending || isTaskRunning || isTaskFailed) && (
                                     <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-10">
                                         {isTaskRunning ? (
                                             <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
                                         ) : isTaskFailed ? (
                                              <div className="text-white text-xs font-bold bg-red-500 px-2 py-1 rounded">Failed</div>
                                         ) : (
                                             <div className="text-white text-xs font-bold bg-indigo-500 px-2 py-1 rounded">Queue</div>
                                         )}
                                     </div>
                                 )}

                                 <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                                 
                                 {/* Actions Overlay */}
                                 <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                     <button onClick={(e) => toggleFav(artist.name, e)} className={`p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm ${isFav ? 'text-yellow-500' : 'text-gray-600 dark:text-white'}`}>
                                         <svg className="w-4 h-4" fill={isFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l1.518-4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                                     </button>
                                     <a href={`https://danbooru.donmai.us/posts?tags=${artist.name}`} target="_blank" rel="noreferrer" className="hidden md:block p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm text-blue-500 dark:text-blue-300 hover:text-blue-600 pointer-events-auto">
                                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                     </a>
                                     <button onClick={(e) => {e.stopPropagation(); setLightboxImg({src: displayImg, name: artist.name})}} className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm text-gray-700 dark:text-white pointer-events-auto">
                                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                                     </button>

                                     {viewMode === 'benchmark' && apiKey && (
                                         <>
                                            <button 
                                                onClick={(e) => queueGeneration(artist, [activeSlot], e)}
                                                className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm pointer-events-auto text-purple-600 hover:text-purple-500"
                                                title={`生成当前组 (Slot ${activeSlot + 1})`}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                            </button>
                                            <button 
                                                onClick={(e) => queueGeneration(artist, config.slots.map((_, i) => i), e)}
                                                className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm pointer-events-auto text-green-600 hover:text-green-500"
                                                title={`一键生成全部 ${config.slots.length} 组`}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" /></svg>
                                            </button>
                                         </>
                                     )}
                                 </div>

                                 {isSelected && (
                                     <div className="absolute inset-0 border-4 border-red-500/80 pointer-events-none">
                                         <div className="absolute top-2 left-2 bg-red-500 text-white p-1 rounded-full shadow-lg">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>
                                         </div>
                                     </div>
                                 )}
                             </div>
                             <div className="p-2 md:p-3 bg-white dark:bg-gray-800 text-center border-t border-gray-100 dark:border-gray-700">
                                 <div className={`text-xs md:text-sm font-bold truncate ${isSelected ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'}`}>{artist.name}</div>
                             </div>
                         </div>
                     )
                 })}
             </div>
         ) : (
             /* --- EXPANDED LIST LAYOUT --- */
             <div className="flex flex-col gap-4 md:pr-6">
                 {filteredArtists.map((artist, idx) => {
                     const isSelected = !!cart.find(c => c.name === artist.name);
                     const isFav = favorites.has(artist.name);
                     // Anchors
                     const prevChar = idx > 0 ? getGroupChar(filteredArtists[idx-1].name) : '';
                     const currChar = getGroupChar(artist.name);
                     const isAnchor = currChar !== prevChar;

                     return (
                         <div 
                            key={artist.id}
                            id={isAnchor ? `anchor-${currChar}` : undefined}
                            className={`bg-white dark:bg-gray-800 rounded-xl border p-4 shadow-sm ${isSelected ? 'border-red-500 dark:border-red-500 ring-1 ring-red-500' : 'border-gray-200 dark:border-gray-700'}`}
                         >
                             {/* Row Header */}
                             <div className="flex justify-between items-center mb-3">
                                 <div className="flex items-center gap-3">
                                     <h3 
                                        className={`font-bold text-lg md:text-xl cursor-pointer hover:underline ${isSelected ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}
                                        onClick={() => toggleCart(artist.name)}
                                     >
                                         {artist.name}
                                     </h3>
                                     <button onClick={(e) => toggleFav(artist.name, e)} className={`${isFav ? 'text-yellow-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
                                         <svg className="w-5 h-5" fill={isFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l1.518-4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                                     </button>
                                     <a href={`https://danbooru.donmai.us/posts?tags=${artist.name}`} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400">
                                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                     </a>
                                 </div>
                                 {apiKey && (
                                     <button 
                                        onClick={(e) => queueGeneration(artist, config.slots.map((_, i) => i), e)}
                                        className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1 rounded hover:bg-green-100 dark:hover:bg-green-900/50 flex items-center gap-1 border border-green-200 dark:border-green-800"
                                        title="生成所有实装"
                                     >
                                         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                         Generate All
                                     </button>
                                 )}
                             </div>

                             {/* Horizontal Scroll/Shrink Container */}
                             <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar flex-nowrap items-stretch">
                                 {/* 1. Original Image */}
                                 <div className="flex flex-col gap-1 flex-shrink-0 min-w-[100px] w-32 lg:w-40 group relative">
                                     <div className="aspect-[2/3] rounded-lg overflow-hidden relative cursor-zoom-in" onClick={() => setLightboxImg({src: artist.imageUrl, name: artist.name})}>
                                         <LazyImage src={artist.imageUrl} alt="原图" />
                                         <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                     </div>
                                     <span className="text-[10px] text-center font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">原图</span>
                                 </div>

                                 {/* 2. Benchmark Slots */}
                                 {config.slots.map((slot, i) => {
                                     const img = artist.benchmarks?.[i];
                                     const taskRunning = currentTask?.artistId === artist.id && currentTask?.slot === i;
                                     const taskPending = taskQueue.some(t => t.artistId === artist.id && t.slot === i);
                                     const taskFailed = failedTasks.some(t => t.artistId === artist.id && t.slot === i);

                                     // Fallback for slot 0 (Legacy previewUrl)
                                     const displayImg = img || (i === 0 ? artist.previewUrl : null);

                                     return (
                                         <div key={i} className="flex flex-col gap-1 flex-shrink-0 min-w-[100px] w-32 lg:w-40 group relative">
                                             <div className="aspect-[2/3] bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden relative border border-gray-200 dark:border-gray-700">
                                                 {displayImg ? (
                                                     <div className="w-full h-full cursor-zoom-in" onClick={() => setLightboxImg({src: displayImg, name: `${artist.name} - ${slot.label}`})}>
                                                         <LazyImage src={displayImg} alt={slot.label} />
                                                     </div>
                                                 ) : (
                                                     <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                                                         <span className="text-xl">?</span>
                                                     </div>
                                                 )}

                                                 {/* Status Overlay */}
                                                 {(taskPending || taskRunning || taskFailed) && (
                                                     <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-10 pointer-events-none">
                                                         {taskRunning ? (
                                                             <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white"></div>
                                                         ) : taskFailed ? (
                                                              <span className="text-[10px] bg-red-500 text-white px-1 rounded">Failed</span>
                                                         ) : (
                                                             <span className="text-[10px] bg-indigo-500 text-white px-1 rounded">Queue</span>
                                                         )}
                                                     </div>
                                                 )}

                                                 {/* Hover Generate Button - MOVED TO CORNER */}
                                                 {apiKey && !taskRunning && !taskPending && (
                                                     <div className="absolute bottom-1 right-1 transition-opacity opacity-0 group-hover:opacity-100 z-10">
                                                         <button 
                                                            onClick={(e) => queueGeneration(artist, [i], e)}
                                                            className="p-1.5 bg-black/60 hover:bg-black/80 backdrop-blur rounded-full text-white transition-colors shadow-sm"
                                                            title={`生成 ${slot.label}`}
                                                         >
                                                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                         </button>
                                                     </div>
                                                 )}
                                             </div>
                                             <span className="text-[11px] text-center text-gray-500 dark:text-gray-400 truncate px-1 font-medium" title={slot.label}>{slot.label}</span>
                                         </div>
                                     );
                                 })}
                             </div>
                         </div>
                     );
                 })}
             </div>
         )}
      </div>

      {/* ... (Rest of the component remains unchanged) ... */}
      
      {/* --- Cart Bar --- */}
      <div className={`absolute bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 transition-transform duration-300 transform shadow-[0_-5px_20px_rgba(0,0,0,0.1)] z-30 ${cart.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="p-4 max-w-6xl mx-auto flex flex-col md:flex-row gap-4 items-center">
              <div className="flex-1 overflow-x-auto flex gap-2 pb-2 md:pb-0 w-full no-scrollbar">
                  {cart.map((item, idx) => (
                      <div key={item.name} className="flex items-center bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 flex-shrink-0 text-sm shadow-sm select-none">
                          <button onClick={() => updateWeight(idx, -1)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white px-1 font-mono font-bold">-</button>
                          <span className="mx-1 font-mono text-indigo-600 dark:text-indigo-300 font-medium">{formatTag(item)}</span>
                          <button onClick={() => updateWeight(idx, 1)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white px-1 font-mono font-bold">+</button>
                          <button onClick={() => toggleCart(item.name)} className="ml-2 text-red-500 hover:text-red-700 border-l border-gray-300 dark:border-gray-600 pl-2">×</button>
                      </div>
                  ))}
              </div>
              <div className="flex gap-2 flex-shrink-0 items-center w-full md:w-auto justify-between md:justify-end">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mr-2">已选 <span className="font-bold text-gray-900 dark:text-white">{cart.length}</span></div>
                  <div className="flex gap-2">
                    <button onClick={() => setCart([])} className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm font-bold transition-colors">清空</button>
                    <button onClick={copyCart} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold shadow-lg shadow-indigo-500/20 transition-colors">复制</button>
                  </div>
              </div>
          </div>
      </div>

      {/* --- Lightbox --- */}
      {lightboxImg && (
          <div className="fixed inset-0 z-50 bg-white/90 dark:bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setLightboxImg(null)}>
              <img src={lightboxImg.src} alt={lightboxImg.name} className="max-w-full max-h-[90vh] rounded shadow-2xl" onClick={e => e.stopPropagation()} />
          </div>
      )}

      {/* --- History Sidebar --- */}
      <div className={`fixed top-0 right-0 w-80 h-full bg-white dark:bg-gray-800 shadow-2xl z-40 transform transition-transform duration-300 border-l border-gray-200 dark:border-gray-700 flex flex-col ${showHistory ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
              <h3 className="font-bold text-gray-800 dark:text-white">📋 复制历史</h3>
              <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-800 dark:hover:text-white">×</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {history.map((h, i) => (
                  <div key={i} onClick={() => {navigator.clipboard.writeText(h.text); notify('已复制')}} className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-500 cursor-pointer transition-colors">
                      <div className="text-xs text-gray-800 dark:text-gray-200 break-all line-clamp-3 font-mono">{h.text}</div>
                      <div className="text-[10px] text-gray-400 mt-2 text-right">{h.time}</div>
                  </div>
              ))}
              {history.length === 0 && <div className="text-center text-gray-400 mt-10">暂无历史</div>}
          </div>
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
             <button onClick={() => {setHistory([]); localStorage.setItem('nai_copy_history', '[]')}} className="w-full py-2 text-sm text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400">清空历史</button>
          </div>
      </div>
      {showHistory && <div className="fixed inset-0 z-30 bg-black/20 dark:bg-black/50 backdrop-blur-[1px]" onClick={() => setShowHistory(false)} />}

      {/* --- Logs Modal --- */}
      {showLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
             <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-6 flex flex-col max-h-[80vh]">
                 <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
                     <h3 className="text-lg font-bold text-gray-900 dark:text-white">任务日志</h3>
                     <button onClick={() => setShowLogs(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white">✕</button>
                 </div>
                 
                 {/* Failed Tasks Section */}
                 {failedTasks.length > 0 && (
                     <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 rounded-lg flex justify-between items-center">
                         <span className="text-sm text-red-700 dark:text-red-300 font-bold">{failedTasks.length} 个任务失败</span>
                         <button 
                             onClick={retryFailedTasks}
                             className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded font-bold shadow-sm"
                         >
                             重试所有失败任务
                         </button>
                     </div>
                 )}
                 
                 <div className="flex-1 overflow-y-auto space-y-2 bg-gray-50 dark:bg-gray-950 p-2 rounded border border-gray-200 dark:border-gray-800">
                     {logs.length === 0 && <div className="text-center text-gray-400 py-4 text-xs">暂无日志</div>}
                     {logs.map((log, i) => (
                         <div key={i} className={`p-2 rounded text-xs font-mono border ${
                             log.type === 'error' ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400' :
                             log.type === 'success' ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-900/50 text-green-600 dark:text-green-400' :
                             'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                         }`}>
                             <span className="opacity-50 mr-2">[{log.time}]</span>
                             {log.message}
                         </div>
                     ))}
                 </div>
             </div>
        </div>
      )}

      {/* --- Import Modal --- */}
      {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">📥 批量导入画师</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">粘贴你的画师串，支持 artist: 前缀和 {'{}'} [] 权重符号</p>
                  <textarea 
                    className="w-full h-32 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg p-3 text-sm text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                    placeholder="例如：artist:wlop, {artist:nixeu}, [[shaluo]]"
                    value={importText}
                    onChange={e => setImportText(e.target.value)}
                  />
                  <div className="flex justify-end gap-3 mt-4">
                      <button onClick={() => setShowImport(false)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">取消</button>
                      <button onClick={handleImport} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-colors">导入</button>
                  </div>
              </div>
          </div>
      )}

      {/* --- Benchmark Config Modal --- */}
      {showConfig && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh] relative">
                  
                  {/* Delete Confirmation Overlay */}
                  {slotToDelete !== null && (
                      <div className="absolute inset-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur flex items-center justify-center rounded-xl p-4">
                          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 max-w-sm text-center">
                              <h4 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">确认删除此分组？</h4>
                              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                                  删除第 {slotToDelete + 1} 组 ({draftConfig.slots[slotToDelete]?.label}) 会导致后续分组序号前移，可能会使已生成的实装图错位。
                              </p>
                              <div className="flex gap-3 justify-center">
                                  <button onClick={() => setSlotToDelete(null)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">取消</button>
                                  <button onClick={confirmDeleteSlot} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-bold shadow-lg transition-colors">确认删除</button>
                              </div>
                          </div>
                      </div>
                  )}

                  <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                      <div className="flex justify-between items-center">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">⚙️ 实装测试配置</h3>
                        <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded">编辑模式</span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">配置生成实装图时的参数。系统会自动添加 <code>artist:NAME</code>。</p>
                  </div>
                  
                  <div className="p-6 overflow-y-auto space-y-6">
                      {/* API Key Input */}
                      <div>
                          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">NovelAI API Key (Bearer Token)</label>
                          <input 
                              type="password" 
                              className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white font-mono"
                              placeholder="pst-..."
                              value={apiKey}
                              onChange={e => handleApiKeyChange(e.target.value)}
                          />
                          <p className="text-[10px] text-gray-400 mt-1">Key 仅保存在浏览器本地，用于直接调用生成接口。</p>
                      </div>

                      <div className="space-y-4">
                          <div className="flex justify-between items-center">
                              <label className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase">测试分组 (Slots)</label>
                              <button onClick={addSlot} className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800">
                                  + 添加分组
                              </button>
                          </div>
                          
                          {draftConfig.slots.map((slot, i) => (
                              <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/50 relative group/slot">
                                  <div className="flex justify-between mb-2 gap-2">
                                      <div className="flex items-center gap-2 flex-1">
                                          <span className="text-xs font-mono text-gray-400 w-4">{i + 1}.</span>
                                          <input 
                                              type="text"
                                              className="text-xs font-bold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none dark:text-white transition-colors w-full"
                                              value={slot.label}
                                              onChange={e => updateSlot(i, 'label', e.target.value)}
                                              placeholder="分组名称"
                                          />
                                      </div>
                                      <button 
                                          onClick={() => handleDeleteClick(i)} // Trigger confirm modal
                                          className="text-gray-400 hover:text-red-500 text-xs px-2"
                                          title="删除此分组"
                                      >
                                          删除
                                      </button>
                                  </div>
                                  <textarea 
                                      className="w-full h-16 p-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-600 rounded text-xs dark:text-white font-mono resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                      value={slot.prompt}
                                      onChange={e => updateSlot(i, 'prompt', e.target.value)}
                                      placeholder="输入测试 Prompt..."
                                  />
                              </div>
                          ))}
                      </div>

                      <div>
                          <label className="block text-xs font-bold text-red-500 dark:text-red-400 mb-1 uppercase">通用负面 (Negative Prompt)</label>
                          <textarea 
                              className="w-full h-16 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs dark:text-white font-mono resize-none focus:ring-1 focus:ring-red-500 outline-none"
                              value={draftConfig.negative}
                              onChange={e => setDraftConfig({...draftConfig, negative: e.target.value})}
                          />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Seed (-1 = Random)</label>
                              <div className="flex gap-2">
                                <input 
                                    type="number" 
                                    className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                    value={draftConfig.seed}
                                    onChange={e => setDraftConfig({...draftConfig, seed: parseInt(e.target.value)})}
                                />
                                <button
                                    onClick={() => setDraftConfig({...draftConfig, seed: Math.floor(Math.random() * 4294967295)})}
                                    className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 flex items-center justify-center"
                                    title="随机生成一个固定 Seed"
                                >
                                    🎲
                                </button>
                              </div>
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Steps / Scale</label>
                              <div className="flex gap-2">
                                  <input 
                                      type="number" placeholder="Steps"
                                      className="w-1/2 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                      value={draftConfig.steps}
                                      onChange={e => setDraftConfig({...draftConfig, steps: parseInt(e.target.value)})}
                                  />
                                  <input 
                                      type="number" placeholder="Scale"
                                      className="w-1/2 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                      value={draftConfig.scale}
                                      onChange={e => setDraftConfig({...draftConfig, scale: parseFloat(e.target.value)})}
                                  />
                              </div>
                          </div>
                      </div>
                  </div>

                  <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-900 rounded-b-xl">
                      <button onClick={() => setShowConfig(false)} className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white">取消</button>
                      <button onClick={saveConfig} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold shadow-lg">保存配置</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};
