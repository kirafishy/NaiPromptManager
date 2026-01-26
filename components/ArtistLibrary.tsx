
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Artist } from '../types';
import { generateImage } from '../services/naiService';
import { db } from '../services/dbService';
import { ArtistLibraryConfig } from './ArtistLibraryConfig';
import { ArtistLibraryCart } from './ArtistLibraryCart';

interface CartItem {
  name: string;
  weight: number; // 0 normal, >0 {}, <0 []
}

interface ArtistLibraryProps {
  isDark: boolean;
  toggleTheme: () => void;
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
        setIsLoaded(false);
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
    slots: BenchmarkSlot[];
    negative: string;
    seed: number;
    steps: number;
    scale: number;
    interval?: number;
}

const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
    slots: [
        { 
            label: "面部", 
            prompt: "masterpiece, best quality, 1girl, solo,\ncowboy shot, slight tilt head, three-quarter view,\nhand on face, peace sign, index finger raised, (dynamic pose),\ndetailed face, detailed eyes, blushing, happy, open mouth,\nmessy hair, hair ornament,\nwhite shirt, collarbone,\nsimple background, soft lighting, " 
        },
        { 
            label: "体态", 
            prompt: "masterpiece, best quality, 1girl, solo,\nkneeling, from above, looking at viewer,\nbikini, wet skin, long hair, floating hair, water ripples,\nsunlight, lens flare, outdoors, pool," 
        },
        {
            label: "风格",
            prompt: "masterpiece, best quality, 1girl, solo,\nstanding, cityscape, night, neon lights, cyberpunk,\njacket, hood, mask, holding weapon, glowing eyes,"
        }
    ],
    negative: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
    seed: 0,
    steps: 28,
    scale: 5,
    interval: 3000
};

export const ArtistLibrary: React.FC<ArtistLibraryProps> = ({ isDark, toggleTheme, artistsData, onRefresh, notify }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [showConfig, setShowConfig] = useState(false);
    
    // Benchmark State
    const [apiKey, setApiKey] = useState('');
    const [benchmarkConfig, setBenchmarkConfig] = useState<BenchmarkConfig>(DEFAULT_BENCHMARK_CONFIG);
    const [processingArtistId, setProcessingArtistId] = useState<string | null>(null);

    // Initial Load
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const cfg = await db.getBenchmarkConfig();
                if (cfg) setBenchmarkConfig(cfg);
            } catch(e) { console.error(e); }
        };
        loadConfig();
        const storedKey = localStorage.getItem('nai_api_key');
        if (storedKey) setApiKey(storedKey);
    }, []);

    // Filter Logic
    const artists = useMemo(() => {
        let data = artistsData || [];
        if (searchTerm) {
            data = data.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        return data;
    }, [artistsData, searchTerm]);

    const groupedArtists = useMemo(() => {
        const groups: Record<string, Artist[]> = {};
        ALPHABET.forEach(char => groups[char] = []);
        artists.forEach(artist => {
            const char = getGroupChar(artist.name);
            if (groups[char]) groups[char].push(artist);
            else groups['#'].push(artist);
        });
        return groups;
    }, [artists]);

    // Cart Logic
    const toggleCart = (name: string) => {
        setCart(prev => {
            const exists = prev.find(i => i.name === name);
            if (exists) return prev.filter(i => i.name !== name);
            return [...prev, { name, weight: 0 }];
        });
    };

    const updateWeight = (index: number, delta: number) => {
        const newCart = [...cart];
        newCart[index].weight += delta;
        setCart(newCart);
    };

    const formatTag = (item: CartItem) => {
        const tag = `artist:${item.name}`;
        if (item.weight > 0) return `{`.repeat(item.weight) + tag + `}`.repeat(item.weight);
        if (item.weight < 0) return `[`.repeat(Math.abs(item.weight)) + tag + `]`.repeat(Math.abs(item.weight));
        return tag;
    };

    const copyCart = () => {
        const text = cart.map(formatTag).join(', ');
        navigator.clipboard.writeText(text);
        notify('已复制组合 Prompt');
    };

    // Benchmark Logic
    const handleApiKeyChange = (val: string) => {
        setApiKey(val);
        localStorage.setItem('nai_api_key', val);
    };

    const handleSaveConfig = async (cfg: BenchmarkConfig) => {
        setBenchmarkConfig(cfg);
        await db.saveBenchmarkConfig(cfg);
        setShowConfig(false);
        notify('配置已保存');
    };

    const runBenchmarkForArtist = async (artist: Artist) => {
        if (!apiKey) {
            notify('请先在配置中设置 API Key', 'error');
            setShowConfig(true);
            return;
        }
        if (processingArtistId) return;

        if(!confirm(`即将为 "${artist.name}" 运行实装测试。\n这将会消耗 NAI 点数 (Anlas)，并覆盖旧的基准图。\n确定继续吗？`)) return;
        
        setProcessingArtistId(artist.id);
        const config = benchmarkConfig;
        const newBenchmarks: string[] = [];
        
        try {
            for (const slot of config.slots) {
                // Construct prompt: slot.prompt + ", artist:" + artist.name
                const finalPrompt = `${slot.prompt}, artist:${artist.name}`;
                const params = {
                    width: 832, height: 1216, 
                    steps: config.steps, 
                    scale: config.scale, 
                    sampler: 'k_euler_ancestral', 
                    seed: config.seed === -1 ? undefined : config.seed,
                    qualityToggle: true, ucPreset: 0
                };
                
                const img = await generateImage(apiKey, finalPrompt, config.negative, params);
                newBenchmarks.push(img);
                
                // Wait interval to be nice to API
                if (config.interval && config.interval > 0) {
                     await new Promise(r => setTimeout(r, config.interval));
                }
            }
            
            // Save to DB (Update only)
            await db.saveArtist({
                ...artist,
                benchmarks: newBenchmarks
            });
            
            notify(`${artist.name} 实装测试完成`);
            onRefresh(); // Refresh UI
            
        } catch (e: any) {
            console.error(e);
            notify(`测试失败: ${e.message}`, 'error');
        } finally {
            setProcessingArtistId(null);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
            {/* Header */}
            <header className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex flex-col md:flex-row gap-4 justify-between items-center z-20 shadow-sm">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white whitespace-nowrap">画师库</h2>
                    <div className="relative w-full md:w-64 group">
                        <input 
                            type="text" 
                            placeholder="搜索画师..." 
                            className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <span className="absolute right-3 top-2.5 text-gray-400">🔍</span>
                    </div>
                </div>

                <div className="flex gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
                     <button 
                        onClick={() => setShowConfig(true)}
                        className="px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 whitespace-nowrap flex items-center gap-1"
                    >
                        <span>⚙️</span> 实装配置
                    </button>
                    <button 
                        onClick={() => onRefresh()} 
                        className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title="刷新"
                    >
                        🔄
                    </button>
                </div>
            </header>

            {/* Alphabet Bar */}
            <div className="hidden md:flex justify-center bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-1 text-[10px] space-x-1 select-none overflow-x-auto">
                {ALPHABET.map(char => (
                    <a 
                        key={char} 
                        href={`#group-${char}`} 
                        className={`px-1.5 py-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900 text-gray-500 dark:text-gray-400 hover:text-indigo-600 ${groupedArtists[char].length === 0 ? 'opacity-30 pointer-events-none' : ''}`}
                    >
                        {char}
                    </a>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 pb-24 scroll-smooth">
                {artists.length === 0 ? (
                    <div className="text-center text-gray-500 dark:text-gray-400 mt-20">
                        <p className="text-xl">未找到画师</p>
                        <p className="text-sm">请尝试其他关键词，或联系管理员添加。</p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {ALPHABET.map(char => {
                            const group = groupedArtists[char];
                            if (group.length === 0) return null;
                            return (
                                <div key={char} id={`group-${char}`}>
                                    <h3 className="text-sm font-bold text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700 mb-3 sticky top-0 bg-gray-50/90 dark:bg-gray-900/90 backdrop-blur z-10 py-1">
                                        {char}
                                    </h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                                        {group.map(artist => {
                                            const inCart = cart.some(i => i.name === artist.name);
                                            const isProcessing = processingArtistId === artist.id;
                                            return (
                                                <div 
                                                    key={artist.id} 
                                                    className={`group relative bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all border ${inCart ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}
                                                >
                                                    {/* Image Area with Hover Benchmarks */}
                                                    <div className="aspect-square relative bg-gray-200 dark:bg-gray-900 overflow-hidden cursor-pointer" onClick={() => toggleCart(artist.name)}>
                                                        {artist.benchmarks && artist.benchmarks.length > 0 ? (
                                                            // Benchmark Slideshow on Hover logic could be complex, for now show 1st benchmark if available, else avatar
                                                            <div className="w-full h-full relative group/img">
                                                                <LazyImage 
                                                                    src={artist.benchmarks[0] || artist.imageUrl} 
                                                                    alt={artist.name} 
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                {/* Hover to show benchmarks hint or simple cycle? Let's keep simple: Show avatar by default, maybe benchmarks in detail view? 
                                                                    Actually user wants to see style. Avatar is usually an example. 
                                                                */}
                                                                {artist.benchmarks.length > 0 && (
                                                                     <div className="absolute bottom-1 right-1 flex gap-0.5">
                                                                         {artist.benchmarks.map((_, i) => (
                                                                             <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/80 shadow"></div>
                                                                         ))}
                                                                     </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <LazyImage src={artist.imageUrl} alt={artist.name} />
                                                        )}
                                                        
                                                        {/* Selection Overlay */}
                                                        {inCart && (
                                                            <div className="absolute inset-0 bg-indigo-900/20 flex items-center justify-center">
                                                                <div className="bg-indigo-600 text-white rounded-full p-1 shadow-lg">
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                                                </div>
                                                            </div>
                                                        )}
                                                        
                                                        {/* Processing Overlay */}
                                                        {isProcessing && (
                                                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20">
                                                                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white mb-2"></div>
                                                                <span className="text-white text-xs font-bold">测试中...</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="p-2">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <div className="font-bold text-gray-900 dark:text-white truncate text-sm" title={artist.name}>{artist.name}</div>
                                                        </div>
                                                        <div className="flex justify-between items-center mt-2">
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); toggleCart(artist.name); }}
                                                                className={`flex-1 py-1 rounded text-xs font-bold transition-colors ${inCart ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
                                                            >
                                                                {inCart ? '已选择' : '选择'}
                                                            </button>
                                                            {/* Benchmark Trigger (Hidden if processing other or no Key) */}
                                                            {apiKey && !processingArtistId && (
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); runBenchmarkForArtist(artist); }}
                                                                    className="ml-2 p-1 text-gray-400 hover:text-indigo-500 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                                                                    title="运行实装测试 (消耗点数)"
                                                                >
                                                                    ⚡
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
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

            {/* Config Modal */}
            <ArtistLibraryConfig 
                show={showConfig}
                onClose={() => setShowConfig(false)}
                onSave={handleSaveConfig}
                initialConfig={benchmarkConfig}
                apiKey={apiKey}
                onApiKeyChange={handleApiKeyChange}
                notify={notify}
            />

            {/* Cart Overlay */}
            <ArtistLibraryCart 
                cart={cart}
                setCart={setCart}
                updateWeight={updateWeight}
                toggleCart={toggleCart}
                copyCart={copyCart}
                formatTag={formatTag}
            />
        </div>
    );
};
