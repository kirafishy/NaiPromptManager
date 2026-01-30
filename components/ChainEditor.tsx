
import React, { useState, useEffect, useRef } from 'react';
import { PromptChain, PromptModule, User, CharacterParams } from '../types';
import { compilePrompt, NAI_QUALITY_TAGS, NAI_UC_PRESETS } from '../services/promptUtils';
import { generateImage } from '../services/naiService';
import { localHistory } from '../services/localHistory';
import { api } from '../services/api';
import { extractMetadata } from '../services/metadataService';
import { ChainEditorParams } from './ChainEditorParams';
import { ChainEditorPreview } from './ChainEditorPreview';

interface ChainEditorProps {
    chain: PromptChain;
    allChains: PromptChain[]; // Need access to other chains for importing
    currentUser: User;
    onUpdateChain: (id: string, updates: Partial<PromptChain>) => void;
    onBack: () => void;
    onFork: (chain: PromptChain) => void;
    setIsDirty: (isDirty: boolean) => void;
    notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ChainEditor: React.FC<ChainEditorProps> = ({ chain, allChains, currentUser, onUpdateChain, onBack, onFork, setIsDirty, notify }) => {
    // Permission Check
    // Guests are allowed to EDIT (in memory) for testing, but NOT SAVE.
    const isGuest = currentUser.role === 'guest';
    const isOwner = !isGuest && (chain.userId === currentUser.id || currentUser.role === 'admin');
    const canEdit = isOwner || isGuest; // Both can interact with inputs now

    // Distinguish Editor Mode
    const isCharacterMode = chain.type === 'character';

    // --- Chain Info State ---
    const [chainName, setChainName] = useState(chain.name);
    const [chainDesc, setChainDesc] = useState(chain.description);
    const [isEditingInfo, setIsEditingInfo] = useState(false);

    // --- Prompt State ---
    const [basePrompt, setBasePrompt] = useState(chain.basePrompt || '');
    const [negativePrompt, setNegativePrompt] = useState(chain.negativePrompt || '');
    const [modules, setModules] = useState<PromptModule[]>(chain.modules || []);
    // Default Seed to undefined (random), UC Preset to 4 (None)
    const [params, setParams] = useState(chain.params || { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined, qualityToggle: true, ucPreset: 4 });

    // --- New: Subject/Variable Prompt State ---
    const [subjectPrompt, setSubjectPrompt] = useState('');

    const [hasChanges, setHasChanges] = useState(false);
    const [lightboxImg, setLightboxImg] = useState<string | null>(null);

    // --- Import Preset Modal State ---
    const [showImportPreset, setShowImportPreset] = useState(false);
    // Detailed Import Config State
    const [importCandidate, setImportCandidate] = useState<PromptChain | null>(null);
    const [importOptions, setImportOptions] = useState({
        importBasePrompt: true,  // Renamed from importPrompt
        importSubject: true,     // New: Subject Prompt
        importNegative: true,    // Negative Prompt
        importModules: true,     // Modules array
        appendModules: false,    // New: Append Modules
        importCharacters: true,  // Characters params
        appendCharacters: false, // Append Characters (if false, replace)
        importSettings: true,    // Resolution, Steps, Scale, Sampler...
        importSeed: true,        // Seed
    });

    // --- Favorites (for preset sort), re-read when opening modal ---
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = localStorage.getItem('nai_chain_favs');
            if (saved) setFavorites(new Set(JSON.parse(saved) as string[]));
        } catch { /* ignore */ }
    }, [showImportPreset]);

    // Sync dirty state with parent (ONLY IF NOT GUEST)
    useEffect(() => {
        if (!isGuest) {
            setIsDirty(hasChanges);
        }
    }, [hasChanges, setIsDirty, isGuest]);

    // --- Testing State ---
    const [activeModules, setActiveModules] = useState<Record<string, boolean>>({});
    const [finalPrompt, setFinalPrompt] = useState('');

    // --- Generation State ---
    const [apiKey, setApiKey] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);

    // --- Initialization ---

    // --- Initialization ---
    const prevChainIdRef = useRef<string | null>(null);
    const [loadedPreset, setLoadedPreset] = useState<string | null>(null);

    useEffect(() => {
        // Only reset state if Chain ID changes.
        // This prevents resetting unsaved work when only metadata (like cover image) updates.
        if (prevChainIdRef.current === chain.id) return;

        prevChainIdRef.current = chain.id;
        setLoadedPreset(null); // Reset loaded preset on chain switch

        setBasePrompt(chain.basePrompt || '');
        setNegativePrompt(chain.negativePrompt || '');
        setModules((chain.modules || []).map(m => ({
            ...m,
            position: m.position || 'post'
        })));
        setParams({
            width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined,
            qualityToggle: true, ucPreset: 4, characters: [],
            useCoords: chain.params?.useCoords ?? false,
            variety: chain.params?.variety ?? false,
            cfgRescale: chain.params?.cfgRescale ?? 0,
            ...chain.params
        });
        setChainName(chain.name);
        setChainDesc(chain.description);

        // Default subject to empty, not '1girl'
        const savedVars = chain.variableValues || {};
        setSubjectPrompt(savedVars['subject'] || '');

        const initialModules: Record<string, boolean> = {};
        if (chain.modules) {
            chain.modules.forEach(m => {
                initialModules[m.id] = m.isActive;
            });
        }
        setActiveModules(initialModules);
        setHasChanges(false);

        // Load API Key
        const savedKey = localStorage.getItem('nai_api_key');
        if (savedKey) setApiKey(savedKey);

    }, [chain.id, chain.basePrompt, chain.negativePrompt, chain.modules, chain.params, chain.name, chain.description, chain.variableValues]);
    // Dependency note: we still list props to satisfy linter, but the guard 'if (prevChainId === chain.id) return' blocks re-execution.


    // --- Logic: Compilation ---
    useEffect(() => {
        const tempChain = {
            basePrompt,
            modules: (modules || []).map(m => ({
                ...m,
                isActive: activeModules[m.id] ?? true
            }))
        } as any;

        const compiled = compilePrompt(tempChain, subjectPrompt);
        setFinalPrompt(compiled);
    }, [basePrompt, modules, activeModules, subjectPrompt]);

    const handleApiKeyChange = (val: string) => {
        setApiKey(val);
        localStorage.setItem('nai_api_key', val);
    };

    const getDownloadFilename = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `NAI-${timestamp}.png`;
    };

    // Helper to mark changes only if owner
    const markChange = () => {
        if (isOwner) setHasChanges(true);
    };

    // --- Handlers: Prompt Editing ---
    const handleModuleChange = (index: number, key: keyof PromptModule, value: any) => {
        if (!canEdit) return;
        const newModules = [...modules];
        newModules[index] = { ...newModules[index], [key]: value };
        setModules(newModules);
        markChange();
    };

    const addModule = () => {
        if (!canEdit) return;
        const newModule: PromptModule = {
            id: crypto.randomUUID(),
            name: '新模块',
            content: '',
            isActive: true,
            position: 'post'
        };
        setModules([...modules, newModule]);
        setActiveModules(prev => ({ ...prev, [newModule.id]: true }));
        markChange();
    };

    const removeModule = (index: number) => {
        if (!canEdit) return;
        const newModules = [...modules];
        newModules.splice(index, 1);
        setModules(newModules);
        markChange();
    };

    // --- Character Handlers ---
    const addCharacter = () => {
        if (!canEdit) return;
        const newChar: CharacterParams = { id: crypto.randomUUID(), prompt: '', x: 0.5, y: 0.5 };
        setParams({ ...params, characters: [...(params.characters || []), newChar] });
        markChange();
    };

    const updateCharacter = (idx: number, updates: Partial<CharacterParams>) => {
        if (!canEdit || !params.characters) return;
        const newChars = [...params.characters];
        newChars[idx] = { ...newChars[idx], ...updates };
        setParams({ ...params, characters: newChars });
        markChange();
    };

    const removeCharacter = (idx: number) => {
        if (!canEdit || !params.characters) return;
        const newChars = [...params.characters];
        newChars.splice(idx, 1);
        setParams({ ...params, characters: newChars });
        markChange();
    };

    // --- Smart Import Logic ---
    const initiateImport = (c: PromptChain) => {
        setImportCandidate(c);

        // Determine type-based defaults
        const isTargetChar = c.type === 'character';

        // Default options based on target type
        setImportOptions({
            importBasePrompt: !isTargetChar,     // Artist: Checked, Char: Unchecked (per Rule 6 & 5)
            importSubject: isTargetChar,         // Char: Checked, Artist: Unchecked (per Rule 5 & 6)
            importNegative: false,               // Both: Unchecked (Rule 5 & 6 say "others unchecked")
            importModules: !isTargetChar,        // Artist: Checked, Char: Unchecked
            appendModules: false,                // Both: Unchecked
            importCharacters: isTargetChar,      // Char: Checked, Artist: Unchecked
            appendCharacters: false,
            importSettings: !isTargetChar,       // Artist: Checked, Char: Unchecked
            importSeed: false,                   // Both: Unchecked
        });
    };

    const confirmImport = () => {
        if (!importCandidate || !canEdit) return;
        const target = importCandidate;

        // 1. Prompt (Base + Subject)
        if (importOptions.importBasePrompt) {
            setBasePrompt(target.basePrompt || '');
        }
        if (importOptions.importSubject) {
            const targetSubject = target.variableValues?.['subject'] || '';
            setSubjectPrompt(targetSubject);
        }

        // 2. Negative
        if (importOptions.importNegative) {
            setNegativePrompt(target.negativePrompt || '');
        }

        // 3. Modules
        if (importOptions.importModules && target.modules && target.modules.length > 0) {
            const newModules = target.modules.map(m => ({ ...m, id: crypto.randomUUID() }));

            if (importOptions.appendModules) {
                setModules(prev => [...prev, ...newModules]); // Append
            } else {
                setModules(newModules); // Replace
            }

            // Update active state
            setActiveModules(prev => {
                const next = importOptions.appendModules ? { ...prev } : {};
                newModules.forEach(m => next[m.id] = m.isActive);
                return next;
            });
        }

        // 4. Characters
        if (importOptions.importCharacters && target.params?.characters) {
            const newChars = target.params.characters.map(c => ({
                ...c,
                id: crypto.randomUUID() // Regen IDs
            }));

            if (importOptions.appendCharacters) {
                setParams(prev => ({ ...prev, characters: [...(prev.characters || []), ...newChars] }));
            } else {
                setParams(prev => ({ ...prev, characters: newChars }));
            }
        }

        // 5. Settings
        if (importOptions.importSettings) {
            setParams(prev => ({
                ...prev,
                steps: target.params?.steps ?? prev.steps,
                scale: target.params?.scale ?? prev.scale,
                sampler: target.params?.sampler ?? prev.sampler,
                width: target.params?.width ?? prev.width,
                height: target.params?.height ?? prev.height,
                qualityToggle: target.params?.qualityToggle ?? prev.qualityToggle,
                ucPreset: target.params?.ucPreset ?? prev.ucPreset,
                cfgRescale: target.params?.cfgRescale ?? prev.cfgRescale,
                variety: target.params?.variety ?? prev.variety,
                useCoords: target.params?.useCoords ?? prev.useCoords
            }));
        }

        // 6. Seed
        if (importOptions.importSeed && target.params?.seed !== undefined) {
            setParams(prev => ({ ...prev, seed: target.params.seed }));
        }

        notify(`已从 "${target.name}" 导入配置`);
        markChange();
        setLoadedPreset(target.name);
        setImportCandidate(null);
        setShowImportPreset(false);
    };

    // --- Import Logic ---
    const handleImportImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!canEdit) return;
        const file = e.target.files?.[0];
        if (!file) return;

        const rawMeta = await extractMetadata(file);
        if (!rawMeta) {
            notify('无法读取图片信息或非 PNG 图片', 'error');
            return;
        }

        if (!confirm('是否用该图片的参数覆盖当前 Base Prompt、Negative Prompt 和参数设置？\n(Subject 和 模块不会被修改)')) return;

        try {
            let prompt = rawMeta;
            let negative = '';
            let newParams: any = { ...params };

            if (rawMeta.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(rawMeta);
                    if (json.prompt) prompt = json.prompt;
                    if (json.uc) negative = json.uc;
                    if (json.steps) newParams.steps = json.steps;
                    if (json.scale) newParams.scale = json.scale;
                    if (json.seed) newParams.seed = json.seed;
                    if (json.sampler) newParams.sampler = json.sampler;
                    if (json.width) newParams.width = json.width;
                    if (json.height) newParams.height = json.height;

                    // Handle Variety+ (controlled by skip_cfg_above_sigma)
                    // If skip_cfg_above_sigma is present (and > 0), Variety is ON.
                    if (json.skip_cfg_above_sigma !== undefined && json.skip_cfg_above_sigma !== null) {
                        newParams.variety = true;
                    } else {
                        newParams.variety = false;
                    }

                    if (json.v4_prompt) {
                        const v4 = json.v4_prompt;
                        if (v4.caption?.base_caption) {
                            prompt = v4.caption.base_caption;
                        }
                        // V4.5 AI Choice / Manual
                        if (v4.use_coords !== undefined) {
                            newParams.useCoords = v4.use_coords;
                        }

                        newParams.characters = [];
                        if (v4.caption?.char_captions && Array.isArray(v4.caption.char_captions)) {
                            newParams.characters = v4.caption.char_captions.map((cc: any) => ({
                                id: crypto.randomUUID(),
                                prompt: cc.char_caption || '',
                                x: cc.centers?.[0]?.x ?? 0.5,
                                y: cc.centers?.[0]?.y ?? 0.5
                            }));
                        }
                    } else {
                        newParams.characters = [];
                    }

                    // Parse V4 Negative Prompts for Characters
                    if (json.v4_negative_prompt) {
                        const v4Neg = json.v4_negative_prompt;
                        if (v4Neg.caption?.base_caption) {
                            negative = v4Neg.caption.base_caption;
                        }

                        // Match negative captions to characters if they exist
                        if (newParams.characters.length > 0 && v4Neg.caption?.char_captions && Array.isArray(v4Neg.caption.char_captions)) {
                            newParams.characters.forEach((char: any, idx: number) => {
                                const negCharCap = v4Neg.caption.char_captions[idx];
                                if (negCharCap && negCharCap.char_caption) {
                                    char.negativePrompt = negCharCap.char_caption;
                                }
                            });
                        }
                    }

                    if (json.cfg_rescale !== undefined) newParams.cfgRescale = json.cfg_rescale;

                } catch (e) { console.error(e); }
            } else {
                // Legacy text format parser (simplified, variety logic might be missed here if not explicit)
                const negIndex = rawMeta.indexOf('Negative prompt:');
                const stepsIndex = rawMeta.indexOf('Steps:');
                if (stepsIndex !== -1) {
                    const paramStr = rawMeta.substring(stepsIndex);
                    const getVal = (key: string) => {
                        const regex = new RegExp(`${key}:\\s*([^,]+)`);
                        const match = paramStr.match(regex);
                        return match ? match[1].trim() : null;
                    };
                    const steps = getVal('Steps');
                    const sampler = getVal('Sampler');
                    const scale = getVal('CFG scale');
                    const seed = getVal('Seed');
                    const size = getVal('Size');
                    if (steps) newParams.steps = parseInt(steps);
                    if (sampler) newParams.sampler = sampler.toLowerCase().replace(/ /g, '_');
                    if (scale) newParams.scale = parseFloat(scale);
                    if (seed) newParams.seed = parseInt(seed);
                    if (size) {
                        const [w, h] = size.split('x').map(Number);
                        newParams.width = w;
                        newParams.height = h;
                    }
                    if (negIndex !== -1 && negIndex < stepsIndex) {
                        prompt = rawMeta.substring(0, negIndex).trim();
                        negative = rawMeta.substring(negIndex + 16, stepsIndex).trim();
                    } else {
                        prompt = rawMeta.substring(0, stepsIndex).trim();
                    }
                }
                newParams.characters = [];
            }

            // --- Process Quality Tags & UC Presets from Strings ---

            // 1. Detect Quality Tags
            // Ends with NAI_QUALITY_TAGS?
            if (prompt.endsWith(NAI_QUALITY_TAGS)) {
                newParams.qualityToggle = true;
                prompt = prompt.substring(0, prompt.length - NAI_QUALITY_TAGS.length);
            } else {
                // If not found, default to false (or true? user said: if contains -> remove & open. implied: else -> false?)
                // Safe default is to assume false if not present, unless we want to force it.
                newParams.qualityToggle = false;
            }

            // 2. Detect UC Preset
            // Check from ID 3 (Human - Longest) to 0. 4 is None.
            newParams.ucPreset = 4; // Default to None
            // We check ID 3 (Human), 2 (Furry), 1 (Light), 0 (Heavy).
            // Note: Human Focus (3) string starts with Heavy (0) string prefix.
            // So we MUST check Human (3) before Heavy (0).
            const checkOrder = [3, 2, 1, 0];

            for (const id of checkOrder) {
                // @ts-ignore
                const presetStr = NAI_UC_PRESETS[id];
                if (negative.startsWith(presetStr)) {
                    newParams.ucPreset = id;
                    negative = negative.substring(presetStr.length);
                    break; // Found matching preset, stop
                }
            }

            setBasePrompt(prompt);
            setNegativePrompt(negative);
            setParams(newParams);
            markChange();
            notify('参数已导入。Quality/UC/Variety 设置已根据 Prompt 内容自动匹配。');
        } catch (e: any) {
            notify('解析失败: ' + e.message, 'error');
        }
        if (importInputRef.current) importInputRef.current.value = '';
    };


    const handleSaveAll = () => {
        if (!isOwner) return;
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        const varValues = { 'subject': subjectPrompt };
        onUpdateChain(chain.id, {
            name: chainName,
            description: chainDesc,
            basePrompt,
            negativePrompt,
            modules: updatedModules,
            params,
            variableValues: varValues
        });
        setHasChanges(false);
        setIsEditingInfo(false);
        notify(`${isCharacterMode ? '角色' : '画师'}串已保存`);
    };

    const handleFork = () => {
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        onFork({
            ...chain,
            basePrompt,
            negativePrompt,
            modules: updatedModules,
            params,
            variableValues: { 'subject': subjectPrompt }
        });
    };

    const toggleModuleActive = (id: string) => {
        setActiveModules(prev => {
            const newState = { ...prev, [id]: !prev[id] };
            markChange();
            return newState;
        });
    };

    const handleGenerate = async () => {
        if (!apiKey) {
            setErrorMsg('请在右上角设置 NovelAI API Key');
            return;
        }
        setIsGenerating(true);
        setErrorMsg(null);
        try {
            const activeParams = { ...params };
            const img = await generateImage(apiKey, finalPrompt, negativePrompt, activeParams);
            setGeneratedImage(img);
            await localHistory.add(img, finalPrompt, activeParams);
        } catch (e: any) {
            setErrorMsg(e.message);
            notify(e.message, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSavePreview = async () => {
        if (!generatedImage || !isOwner) return;
        if (confirm('将当前生成的图片设为该串的封面图？\n\n警告：此操作将永久删除旧的封面图（如果是上传的图片）。')) {
            setIsUploading(true);
            try {
                const res = await fetch(generatedImage);
                const blob = await res.blob();
                const file = new File([blob], getDownloadFilename(), { type: 'image/png' });
                const uploadRes = await api.uploadFile(file, 'covers');
                await onUpdateChain(chain.id, { previewImage: uploadRes.url });
                notify('封面已更新 (刷新列表查看效果)');
            } catch (e: any) {
                notify('设置封面失败: ' + e.message, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!isOwner) return;
        const file = e.target.files?.[0];
        if (!file) return;
        if (confirm('您确定要上传新封面吗？\n\n警告：此操作将永久删除旧的封面图文件。')) {
            setIsUploading(true);
            try {
                const res = await api.uploadFile(file, 'covers');
                await onUpdateChain(chain.id, { previewImage: res.url });
                notify('封面已更新');
            } catch (err: any) {
                notify('上传失败: ' + err.message, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const copyPromptToClipboard = (isNegative: boolean) => {
        if (isNegative) {
            navigator.clipboard.writeText(negativePrompt);
            notify('负面提示词已复制');
        } else {
            navigator.clipboard.writeText(finalPrompt);
            notify('完整正面提示词已复制');
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors">
            {/* Top Bar */}
            <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-3 flex items-center justify-between gap-2 md:gap-4 overflow-x-hidden">
                <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
                    <button onClick={onBack} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-colors flex-shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7m-7 7h18" /></svg>
                    </button>

                    {isEditingInfo && isOwner ? (
                        <div className="flex flex-col md:flex-row gap-2 flex-1 w-full max-w-2xl min-w-0">
                            <input type="text" value={chainName} onChange={e => { setChainName(e.target.value); markChange() }} className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-900 dark:text-white text-sm focus:border-indigo-500 outline-none font-bold min-w-0" placeholder="名称" />
                            <div className="flex gap-2">
                                <input type="text" value={chainDesc} onChange={e => { setChainDesc(e.target.value); markChange() }} className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-300 text-sm focus:border-indigo-500 outline-none min-w-0" placeholder="描述" />
                                <button
                                    onClick={() => setIsEditingInfo(false)}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm font-medium flex-shrink-0 whitespace-nowrap"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 group cursor-pointer min-w-0 flex-1" onClick={() => isOwner && setIsEditingInfo(true)}>
                            <div className="flex flex-col md:flex-row md:items-baseline gap-0.5 md:gap-2 overflow-hidden min-w-0">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border flex-shrink-0 ${isCharacterMode ? 'bg-pink-100 text-pink-700 border-pink-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                                    {isCharacterMode ? '角色串' : '画师串'}
                                </span>
                                <h1 className="text-base md:text-lg font-bold text-gray-900 dark:text-white truncate min-w-0">{chainName}</h1>
                                <span className="text-xs text-gray-500 dark:text-gray-500 truncate block max-w-full md:max-w-xs min-w-0">{chainDesc}</span>
                            </div>
                            {isOwner && <svg className="w-4 h-4 text-gray-400 opacity-50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1 md:gap-4 flex-shrink-0 ml-auto">
                    <div className="flex gap-1">
                        <button
                            onClick={() => copyPromptToClipboard(false)}
                            className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
                            title="复制完整正面提示词"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                        </button>
                        <button
                            onClick={() => copyPromptToClipboard(true)}
                            className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                            title="复制负面提示词"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                        </button>
                    </div>

                    <div className="relative group">
                        <input
                            type="password"
                            placeholder="API Key"
                            className="w-16 md:w-32 focus:w-40 md:focus:w-64 transition-all bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
                            value={apiKey}
                            onChange={(e) => handleApiKeyChange(e.target.value)}
                        />
                    </div>

                    {!isOwner && !isGuest && (
                        <button
                            onClick={handleFork}
                            className="px-2 md:px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium shadow-lg shadow-green-500/20 flex items-center"
                        >
                            <svg className="w-4 h-4 md:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
                            <span className="hidden md:inline">Fork</span>
                        </button>
                    )}
                </div>
            </header>

            {/* Editor Content */}
            <div className={`flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden ${isOwner ? 'pb-20 lg:pb-0' : ''}`}>
                {/* Left Panel - Editor */}
                <div className="w-full lg:w-1/2 flex flex-col border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800 lg:overflow-y-auto bg-white dark:bg-gray-900 relative order-2 lg:order-1 lg:flex-1 shrink-0">
                    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full pb-32 md:pb-24">
                        {!isOwner && (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded mb-4 text-sm text-yellow-700 dark:text-yellow-400">
                                {isGuest
                                    ? '您正在以游客身份浏览。您可以自由修改 Prompt 进行测试，但无法保存更改。'
                                    : '您正在查看他人的串，无法直接修改。您可以调整参数进行测试，或点击右上角“Fork”保存到您的列表。'
                                }
                            </div>
                        )}

                        {/* Base Prompt */}
                        <section>
                            <div className="flex justify-between items-end mb-2">
                                <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">
                                    1. 基础画风
                                </label>

                                {/* Import & Load Preset Buttons */}
                                <div className="flex items-center gap-2">
                                    {loadedPreset && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50 flex items-center gap-1 font-mono">
                                            <span className="opacity-50">PRESET:</span> {loadedPreset}
                                        </span>
                                    )}

                                    {canEdit && (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setShowImportPreset(true)}
                                                className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex items-center gap-1"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                                引用预设
                                            </button>

                                            <input
                                                type="file"
                                                ref={importInputRef}
                                                className="hidden"
                                                accept="image/png"
                                                onChange={handleImportImage}
                                            />
                                            <button
                                                onClick={() => importInputRef.current?.click()}
                                                className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex items-center gap-1"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                                导入图片配置
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <textarea
                                disabled={!canEdit}
                                className={`w-full border rounded-lg p-3 outline-none font-mono text-sm leading-relaxed min-h-[100px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-indigo-500'}`}
                                value={basePrompt}
                                placeholder="画风标签，如 masterpiece、best quality、画师tag等，英文逗号分隔"
                                onChange={(e) => { setBasePrompt(e.target.value); markChange() }}
                            />
                        </section>

                        {/* Modules */}
                        <section>
                            <div className="flex justify-between items-center mb-3">
                                <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">
                                    2. 模块
                                </label>
                                {canEdit && (
                                    <button onClick={addModule} className="text-xs flex items-center bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700">
                                        添加
                                    </button>
                                )}
                            </div>
                            <div className="space-y-3">
                                {(modules || []).map((mod, idx) => (
                                    <div key={mod.id} className={`bg-gray-50 dark:bg-gray-800/40 border rounded-lg p-3 ${activeModules[mod.id] !== false ? 'border-gray-300 dark:border-gray-700' : 'border-gray-200 dark:border-gray-800 opacity-60'}`}>
                                        <div className="flex flex-wrap gap-2 mb-2 items-center">
                                            <input type="checkbox" checked={activeModules[mod.id] !== false} onChange={() => toggleModuleActive(mod.id)} className="rounded bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-0 flex-shrink-0" />
                                            <input
                                                type="text"
                                                disabled={!canEdit}
                                                className="bg-transparent border-b border-transparent focus:border-indigo-500 text-indigo-600 dark:text-indigo-300 font-medium text-sm outline-none px-1 flex-1 min-w-[120px]"
                                                value={mod.name}
                                                onChange={(e) => handleModuleChange(idx, 'name', e.target.value)}
                                            />
                                            <div className="flex bg-gray-200 dark:bg-gray-700 rounded p-0.5 ml-auto flex-shrink-0">
                                                <button
                                                    onClick={() => handleModuleChange(idx, 'position', 'pre')}
                                                    disabled={!canEdit}
                                                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mod.position === 'pre' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                                >
                                                    前置
                                                </button>
                                                <button
                                                    onClick={() => handleModuleChange(idx, 'position', 'post')}
                                                    disabled={!canEdit}
                                                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${(mod.position === 'post' || !mod.position) ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                                >
                                                    后置
                                                </button>
                                            </div>
                                            {canEdit && (
                                                <button onClick={() => removeModule(idx)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                </button>
                                            )}
                                        </div>
                                        <textarea
                                            disabled={!canEdit}
                                            className={`w-full rounded p-2 outline-none font-mono text-xs h-16 resize-none ${!canEdit ? 'bg-transparent text-gray-500' : 'bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700/30 text-gray-800 dark:text-gray-300 focus:ring-1 focus:ring-indigo-500/50'}`}
                                            value={mod.content}
                                            onChange={(e) => handleModuleChange(idx, 'content', e.target.value)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Character Management (New V4.5) */}
                        <section className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-100 dark:border-indigo-800/50">
                            <div className="flex justify-between items-center mb-3">
                                <label className="block text-sm font-semibold text-indigo-600 dark:text-indigo-300">3. 多角色管理</label>
                                <div className="flex gap-2 items-center">
                                    {/* AI Choice Toggle */}
                                    <label className="flex items-center gap-1.5 cursor-pointer bg-white dark:bg-gray-700 px-2 py-1 rounded shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 border border-transparent dark:border-gray-600">
                                        <input
                                            type="checkbox"
                                            disabled={!canEdit}
                                            checked={!(params.useCoords ?? true)}
                                            onChange={(e) => {
                                                setParams({ ...params, useCoords: !e.target.checked });
                                                markChange();
                                            }}
                                            className="w-3.5 h-3.5 text-indigo-600 rounded focus:ring-0"
                                        />
                                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">AI 自动构图</span>
                                    </label>

                                    {canEdit && (
                                        <button onClick={addCharacter} className="text-xs flex items-center bg-white dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm text-indigo-600 dark:text-indigo-200">
                                            + 添加角色
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {(params.characters || []).length === 0 && (
                                    <div className="text-xs text-gray-400 text-center py-2">暂无角色定义，提示词将作为整体处理。</div>
                                )}
                                {(params.characters || []).map((char, idx) => (
                                    <div key={char.id} className="bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700 shadow-sm relative">
                                        <div className="flex gap-3 items-start">
                                            <div className="flex-1 space-y-2">
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">人物描述</label>
                                                    <textarea
                                                        disabled={!canEdit}
                                                        value={char.prompt}
                                                        onChange={(e) => updateCharacter(idx, { prompt: e.target.value })}
                                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-16 resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                                        placeholder="人物描述"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">专属负面</label>
                                                    <textarea
                                                        disabled={!canEdit}
                                                        value={char.negativePrompt || ''}
                                                        onChange={(e) => updateCharacter(idx, { negativePrompt: e.target.value })}
                                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-10 resize-none focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-400"
                                                        placeholder="选填"
                                                    />
                                                </div>
                                            </div>
                                            <div className="w-24 flex flex-col gap-2">
                                                <div className={!(params.useCoords ?? true) ? "opacity-40 pointer-events-none grayscale" : ""}>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Center X</label>
                                                    <input
                                                        type="number" step="0.1" min="0" max="1"
                                                        disabled={!canEdit}
                                                        value={char.x}
                                                        onChange={(e) => updateCharacter(idx, { x: parseFloat(e.target.value) })}
                                                        className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                                    />
                                                </div>
                                                <div className={!(params.useCoords ?? true) ? "opacity-40 pointer-events-none grayscale" : ""}>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Center Y</label>
                                                    <input
                                                        type="number" step="0.1" min="0" max="1"
                                                        disabled={!canEdit}
                                                        value={char.y}
                                                        onChange={(e) => updateCharacter(idx, { y: parseFloat(e.target.value) })}
                                                        className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                                    />
                                                </div>
                                            </div>
                                            {canEdit && (
                                                <button onClick={() => removeCharacter(idx)} className="text-gray-400 hover:text-red-500 mt-6">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Negative Prompt */}
                        <section className="mb-8">
                            <label className="block text-sm font-semibold text-red-500 dark:text-red-400 mb-2">全局负面提示词</label>
                            <textarea
                                disabled={!canEdit}
                                className={`w-full border rounded-lg p-3 outline-none font-mono text-sm leading-relaxed min-h-[80px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-red-900 dark:text-red-100/80 focus:ring-1 focus:ring-red-500/50'}`}
                                value={negativePrompt}
                                onChange={(e) => { setNegativePrompt(e.target.value); markChange() }}
                            />
                        </section>

                        {/* Params Component */}
                        <ChainEditorParams
                            params={params}
                            setParams={setParams}
                            canEdit={canEdit}
                            markChange={markChange}
                        />
                    </div>

                    {/* Save Footer: fixed on mobile so always visible, sticky in left panel on lg */}
                    {isOwner && (
                        <div className="fixed bottom-0 left-0 right-0 lg:sticky lg:left-auto lg:right-auto lg:bottom-0 z-50 w-full p-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 flex justify-between items-center shadow-lg transition-transform duration-300">
                            <div className="text-xs text-gray-500 ml-2">
                                {hasChanges ? <span className="text-yellow-600 dark:text-yellow-500 font-medium">⚠️ 未保存</span> : <span className="text-green-600 dark:text-green-500">✅ 已保存</span>}
                            </div>
                            <button
                                onClick={handleSaveAll}
                                disabled={!hasChanges}
                                className={`px-6 py-1.5 rounded-md font-bold text-sm shadow-md transition-all transform active:scale-95 ${hasChanges
                                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 text-white shadow-indigo-500/30'
                                    : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                                    }`}
                            >
                                保存
                            </button>
                        </div>
                    )}
                </div>

                {/* Right Panel - Preview (Testing) - Extracted Component */}
                <ChainEditorPreview
                    subjectPrompt={subjectPrompt}
                    setSubjectPrompt={(s) => { setSubjectPrompt(s); markChange(); }}
                    isGenerating={isGenerating}
                    handleGenerate={handleGenerate}
                    errorMsg={errorMsg}
                    generatedImage={generatedImage}
                    previewImage={chain.previewImage}
                    setLightboxImg={setLightboxImg}
                    isOwner={isOwner}
                    isUploading={isUploading}
                    handleSavePreview={handleSavePreview}
                    handleUploadCover={handleUploadCover}
                    getDownloadFilename={getDownloadFilename}
                />
            </div>

            {/* Lightbox Modal */}
            {lightboxImg && (
                <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
                    <img src={lightboxImg} className="max-w-full max-h-full object-contain rounded shadow-2xl" onClick={e => e.stopPropagation()} />
                    <button className="absolute top-4 right-4 text-white hover:text-gray-300" onClick={() => setLightboxImg(null)}>
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            )}

            {/* Import Preset List Modal */}
            {showImportPreset && !importCandidate && (() => {
                const filtered = allChains.filter(c => (isCharacterMode ? (c.type === 'style' || !c.type) : c.type === 'character'));
                const sorted = [...filtered].sort((a, b) => {
                    const aFav = favorites.has(a.id); const bFav = favorites.has(b.id);
                    if (aFav && !bFav) return -1; if (!aFav && bFav) return 1; return 0;
                });
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-4xl md:max-w-5xl lg:max-w-6xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh]">
                            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                                <h3 className="font-bold dark:text-white">
                                    引用{isCharacterMode ? '画师串' : '角色串'}预设
                                </h3>
                                <button onClick={() => setShowImportPreset(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">✕</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 min-h-0">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                    {sorted.map(c => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => initiateImport(c)}
                                            className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 bg-white dark:bg-gray-800/80 overflow-hidden text-left transition-colors"
                                        >
                                            <div className="aspect-square w-full bg-gray-100 dark:bg-gray-700 flex-shrink-0 relative">
                                                {c.previewImage ? (
                                                    <img src={c.previewImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">无图</div>
                                                )}
                                                {favorites.has(c.id) && (
                                                    <span className="absolute top-1 right-1 text-amber-500" title="已收藏">★</span>
                                                )}
                                            </div>
                                            <div className="p-2 flex-1 min-h-0 flex flex-col">
                                                <div className="font-semibold text-sm dark:text-gray-200 truncate">{c.name}</div>
                                                <div className="text-xs text-gray-500 truncate mt-0.5 flex-1">{c.description || '无描述'}</div>
                                                <span className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">选择</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {sorted.length === 0 && (
                                    <div className="text-center text-gray-400 py-12 text-sm">暂无可用预设</div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Import Detail/Confirm Modal */}
            {importCandidate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-t-xl">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate" title={importCandidate.name}>
                                导入: {importCandidate.name}
                            </h3>
                        </div>
                        <div className="p-5 space-y-3">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importBasePrompt} onChange={e => setImportOptions({ ...importOptions, importBasePrompt: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">1. 基础画风 (Base Style)</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSubject} onChange={e => setImportOptions({ ...importOptions, importSubject: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">主体提示词 (Subject)</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importNegative} onChange={e => setImportOptions({ ...importOptions, importNegative: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">负面提示词 (NC)</span>
                            </label>

                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={importOptions.importModules} onChange={e => setImportOptions({ ...importOptions, importModules: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-sm font-medium dark:text-gray-200">增强模块 (Modules)</span>
                                </label>
                                {importOptions.importModules && (
                                    <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                        <input type="checkbox" checked={importOptions.appendModules} onChange={e => setImportOptions({ ...importOptions, appendModules: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">追加 (Append)</span>
                                    </label>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={importOptions.importCharacters} onChange={e => setImportOptions({ ...importOptions, importCharacters: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-sm font-medium dark:text-gray-200">多角色管理 (Characters)</span>
                                </label>
                                {importOptions.importCharacters && (
                                    <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                        <input type="checkbox" checked={importOptions.appendCharacters} onChange={e => setImportOptions({ ...importOptions, appendCharacters: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">追加 (Append)</span>
                                    </label>
                                )}
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSettings} onChange={e => setImportOptions({ ...importOptions, importSettings: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">生成参数 (Settings)</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSeed} onChange={e => setImportOptions({ ...importOptions, importSeed: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">种子 (Seed)</span>
                            </label>
                        </div>
                        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                            <button onClick={() => setImportCandidate(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">取消</button>
                            <button onClick={confirmImport} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded shadow-lg shadow-indigo-500/20 transition-all">导入</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
