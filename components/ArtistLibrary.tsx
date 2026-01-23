
import React, { useState, useEffect, useRef } from 'react';
import { Artist } from '../types';
import { generateImage } from '../services/naiService'; // Import generation service
import { api } from '../services/api'; // Import api for updating

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
const LazyImage: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
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
                    <span className="animate-pulse">...</span>
                </div>
            )}
        </div>
    );
};

// --- Benchmark Config Interface ---
interface BenchmarkConfig {
    prompts: string[]; // [Slot 1, Slot 2, Slot 3]
    negative: string;
    seed: number;
    steps: number;
    scale: number;
}

const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
    prompts: [
        "1girl, portrait, face focus, detailed eyes, hands on face, detailed fingers, expression, masterpiece, best quality",
        "1girl, cowboy shot, detailed torso, anatomy focus, detailed skin, soft lighting, masterpiece, best quality",
        "1girl, full body, wide shot, detailed background, complex scene, perspective, scenery, masterpiece, best quality"
    ],
    negative: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
    seed: -1, // Random
    steps: 28,
    scale: 5
};

// Queue Item Interface
interface GenTask {
    uniqueId: string;
    artistId: string;
    slot: number;
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
  
  // Benchmark / Preview Mode State
  const [viewMode, setViewMode] = useState<'original' | 'benchmark'>('original');
  const [activeSlot, setActiveSlot] = useState<number>(0); // 0, 1, 2
  
  // Benchmark Settings
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<BenchmarkConfig>(DEFAULT_BENCHMARK_CONFIG);
  const [apiKey, setApiKey] = useState('');

  // Queue System
  const [taskQueue, setTaskQueue] = useState<GenTask[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTask, setCurrentTask] = useState<GenTask | null>(null);

  // Load data & Config
  useEffect(() => {
    const savedFav = localStorage.getItem('nai_fav_artists');
    if (savedFav) setFavorites(new Set(JSON.parse(savedFav)));
    
    const savedPrefix = localStorage.getItem('nai_use_prefix');
    if (savedPrefix !== null) setUsePrefix(savedPrefix === 'true');

    const savedHistory = localStorage.getItem('nai_copy_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));

    const savedConfig = localStorage.getItem('nai_benchmark_config');
    if (savedConfig) setConfig(JSON.parse(savedConfig));

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
    const newHistory = [newEntry, ...history.filter(h => h.text !== text)].slice(0, 30);
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

  const filteredArtists = (artistsData || []).filter(a => {
    if (showFavOnly && !favorites.has(a.name)) return false;
    if (searchTerm) return a.name.toLowerCase().includes(searchTerm.toLowerCase());
    return true;
  });

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

  const saveConfig = () => {
      localStorage.setItem('nai_benchmark_config', JSON.stringify(config));
      setShowConfig(false);
      notify('配置已保存');
  };

  // --- Queue Processor ---
  useEffect(() => {
      const processNext = async () => {
          if (isProcessing || taskQueue.length === 0) return;
          
          const task = taskQueue[0];
          setIsProcessing(true);
          setCurrentTask(task);

          try {
              // Find the artist info
              const artist = artistsData?.find(a => a.id === task.artistId);
              if (!artist) {
                  throw new Error(`Artist ${task.artistId} not found`);
              }

              // Actual generation Logic
              const slotPrompt = config.prompts[task.slot] || config.prompts[0];
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
              
              // Pad array
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

          } catch (err: any) {
              console.error(err);
              notify(`生成失败: ${err.message}`, 'error');
          } finally {
              // Remove done task and loop
              setTaskQueue(prev => prev.slice(1));
              setCurrentTask(null);
              setIsProcessing(false);
          }
      };

      processNext();
  }, [taskQueue, isProcessing, apiKey, config, artistsData, onRefresh, notify]);


  // Add tasks to queue
  const queueGeneration = (artist: Artist, slots: number[], e: React.MouseEvent) => {
      e.stopPropagation();
      if (!apiKey) {
          notify('请先在设置中配置 API Key', 'error');
          setShowConfig(true);
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
            {/* View Toggle */}
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
                    实装 <span className="text-[10px] opacity-60">Beta</span>
                </button>
            </div>

            {/* Benchmark Sub-Toggles (Only show in benchmark mode) */}
            {viewMode === 'benchmark' && (
                <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-1 border border-gray-200 dark:border-gray-700 overflow-x-auto">
                    {[
                        { id: 0, label: '1. 面部' },
                        { id: 1, label: '2. 体态' },
                        { id: 2, label: '3. 场景' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSlot(tab.id)}
                            className={`px-3 py-1 rounded text-xs font-medium transition-all whitespace-nowrap ${activeSlot === tab.id ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                    <button 
                        onClick={() => setShowConfig(true)}
                        className="px-2 py-1 ml-1 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        title="实装设置"
                    >
                        ⚙️
                    </button>
                </div>
            )}

            {/* Settings Group */}
            <div className="flex gap-2 items-center ml-auto">
                {taskQueue.length > 0 && (
                    <div className="text-xs font-mono text-indigo-500 animate-pulse bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded">
                        Queue: {taskQueue.length}
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

      {/* --- Grid Content --- */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 md:pl-14 pb-40 bg-gray-50 dark:bg-gray-900 scroll-smooth relative">
         {isLoading && (
             <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-gray-900/80 z-20">
                 <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
             </div>
         )}
         
         {/* Updated Grid Columns for Mobile: grid-cols-2 */}
         <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-4 md:pr-6"> 
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
                     // Check new benchmarks array first
                     if (artist.benchmarks && artist.benchmarks[activeSlot]) {
                         // Add random query param to bust cache if regenerating
                         displayImg = artist.benchmarks[activeSlot] + `?t=${Date.now()}`;
                     } 
                     // Fallback to legacy previewUrl for Slot 0 ONLY
                     else if (activeSlot === 0 && artist.previewUrl) {
                         displayImg = artist.previewUrl + `?t=${Date.now()}`;
                     } 
                     else {
                         isBenchmarkMissing = true;
                     }
                 }

                 // Task status
                 const isTaskPending = taskQueue.some(t => t.artistId === artist.id);
                 const isTaskRunning = currentTask?.artistId === artist.id;
                 
                 return (
                     <div 
                        key={artist.id} 
                        id={isAnchor ? `anchor-${currChar}` : undefined}
                        className={`group relative bg-white dark:bg-gray-800 rounded-xl overflow-hidden border transition-all cursor-pointer shadow-sm hover:shadow-lg ${isSelected ? 'border-red-500 dark:border-red-500 ring-1 ring-red-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-500'}`}
                        onClick={() => toggleCart(artist.name)}
                     >
                         <div className="aspect-square relative overflow-hidden bg-gray-200 dark:bg-gray-900">
                             {/* Use Custom Lazy Image */}
                             {!isBenchmarkMissing ? (
                                <LazyImage src={displayImg} alt={artist.name} />
                             ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                                    <span className="text-2xl mb-1">🤖</span>
                                    <span className="text-[10px]">Slot {activeSlot + 1} Empty</span>
                                </div>
                             )}
                             
                             {/* Task Status Overlay */}
                             {(isTaskPending || isTaskRunning) && (
                                 <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-10">
                                     {isTaskRunning ? (
                                         <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
                                     ) : (
                                         <div className="text-white text-xs font-bold bg-indigo-500 px-2 py-1 rounded">Queue</div>
                                     )}
                                 </div>
                             )}

                             <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                             
                             {/* Actions Overlay */}
                             <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                 <button onClick={(e) => toggleFav(artist.name, e)} className={`p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm ${isFav ? 'text-yellow-500' : 'text-gray-600 dark:text-white'}`}>
                                     <svg className="w-4 h-4" fill={isFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                                 </button>
                                 <a href={`https://danbooru.donmai.us/posts?tags=${artist.name}`} target="_blank" rel="noreferrer" className="hidden md:block p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm text-blue-500 dark:text-blue-300 hover:text-blue-600 pointer-events-auto">
                                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                 </a>
                                 <button onClick={(e) => {e.stopPropagation(); setLightboxImg({src: displayImg, name: artist.name})}} className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm text-gray-700 dark:text-white pointer-events-auto">
                                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                                 </button>

                                 {/* Admin Benchmark Generation Buttons */}
                                 {viewMode === 'benchmark' && apiKey && (
                                     <>
                                        {/* Generate Current Slot */}
                                        <button 
                                            onClick={(e) => queueGeneration(artist, [activeSlot], e)}
                                            className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm pointer-events-auto text-purple-600 hover:text-purple-500"
                                            title={`生成当前组 (Slot ${activeSlot + 1})`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                        </button>
                                        {/* Generate ALL 3 Slots */}
                                        <button 
                                            onClick={(e) => queueGeneration(artist, [0, 1, 2], e)}
                                            className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm pointer-events-auto text-green-600 hover:text-green-500"
                                            title="一键生成 3 组实装图"
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
      </div>

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
              <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">⚙️ 实装测试配置</h3>
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
                          {[
                              { i: 0, label: "测试组 1: 面部 (Face, Hands)" },
                              { i: 1, label: "测试组 2: 体态 (Torso, Skin)" },
                              { i: 2, label: "测试组 3: 场景 (Scene, Full Body)" }
                          ].map(g => (
                              <div key={g.i}>
                                  <label className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-1 uppercase">{g.label}</label>
                                  <textarea 
                                      className="w-full h-20 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs dark:text-white font-mono resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                      value={config.prompts[g.i]}
                                      onChange={e => {
                                          const newPrompts = [...config.prompts];
                                          newPrompts[g.i] = e.target.value;
                                          setConfig({...config, prompts: newPrompts});
                                      }}
                                  />
                              </div>
                          ))}
                      </div>

                      <div>
                          <label className="block text-xs font-bold text-red-500 dark:text-red-400 mb-1 uppercase">通用负面 (Negative Prompt)</label>
                          <textarea 
                              className="w-full h-16 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs dark:text-white font-mono resize-none focus:ring-1 focus:ring-red-500 outline-none"
                              value={config.negative}
                              onChange={e => setConfig({...config, negative: e.target.value})}
                          />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Seed (-1 = Random)</label>
                              <input 
                                  type="number" 
                                  className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                  value={config.seed}
                                  onChange={e => setConfig({...config, seed: parseInt(e.target.value)})}
                              />
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Steps / Scale</label>
                              <div className="flex gap-2">
                                  <input 
                                      type="number" placeholder="Steps"
                                      className="w-1/2 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                      value={config.steps}
                                      onChange={e => setConfig({...config, steps: parseInt(e.target.value)})}
                                  />
                                  <input 
                                      type="number" placeholder="Scale"
                                      className="w-1/2 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                      value={config.scale}
                                      onChange={e => setConfig({...config, scale: parseFloat(e.target.value)})}
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
