
import React, { useState, useEffect, useRef } from 'react';
import { PromptChain, PromptModule, User, CharacterParams, NAIParams } from '../types';
import { compilePrompt } from '../services/promptUtils';
import { generateImage, generateImageStream } from '../services/naiService';
import { getApiKey } from '../services/apiKeyStore';
import { refreshNaiAccount } from '../services/naiAccountStore';
import { DEFAULT_NAI_PARAMS, isV5Model } from '../services/naiModels';
import { dataUriHasAlpha } from '../services/pngAlpha';
import { ApiKeySheet, Button, Chip, Collapse, Field, IconButton, IconClose, IconPalette, IconUser, Input, Portal, Seg, Select, Tag, Textarea, Toggle, useApiKeyConfigured } from './ui';
import { cx } from './ui/cx';
import { localHistory } from '../services/localHistory';
import { compressPngToJpg, shouldApplyAutoJpgSave } from '../services/imageCompression';
import { api } from '../services/api';
import { extractMetadata, parseNovelAIMetadata, IMPORT_SESSION_KEY } from '../services/metadataService';
import { ChainEditorParams } from './ChainEditorParams';
import { ChainEditorPreview } from './ChainEditorPreview';
import { ChainEditorVibePanel } from './ChainEditorVibePanel';
import { useFeedback } from './ui/Feedback';
import { SaveAsChainSheet } from './SaveAsChainSheet';
import { AddCharacterPicker } from './AddCharacterPicker';
import { vibeLibrary } from '../services/vibeLibrary';
import { resolveVibeMounts, validateVibeMounts } from '../services/vibeResolve';

interface ChainEditorProps {
    chain: PromptChain;
    allChains: PromptChain[]; // Need access to other chains for importing
    currentUser: User;
    onUpdateChain: (id: string, updates: Partial<PromptChain>) => void;
    onBack: () => void;
    onFork: (chain: PromptChain, targetType?: 'style' | 'character') => void;
    setIsDirty: (isDirty: boolean) => void;
    notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ChainEditor: React.FC<ChainEditorProps> = ({ chain, allChains, currentUser, onUpdateChain, onBack, onFork, setIsDirty, notify }) => {
    const { confirm } = useFeedback();
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
    const [chainTags, setChainTags] = useState<string[]>(chain.tags || []);
    const [guestHidden, setGuestHidden] = useState(chain.guestHidden || false);
    const [isPrivate, setIsPrivate] = useState(chain.isPrivate || false);
    const [isEditingInfo, setIsEditingInfo] = useState(false);

    // --- Prompt State ---
    const [basePrompt, setBasePrompt] = useState(chain.basePrompt || '');
    const [negativePrompt, setNegativePrompt] = useState(chain.negativePrompt || '');
    const [modules, setModules] = useState<PromptModule[]>(chain.modules || []);
    // Default Seed to undefined (random), UC Preset to 4 (None)
    const [params, setParams] = useState(chain.params || { ...DEFAULT_NAI_PARAMS });

    // --- New: Subject/Variable Prompt State ---
    const [subjectPrompt, setSubjectPrompt] = useState('');

    const [hasChanges, setHasChanges] = useState(false);
    const [lightboxImg, setLightboxImg] = useState<string | null>(null);

    // --- Import Preset Modal State ---
    // New state for import modal search and tags
    const [importModalSearch, setImportModalSearch] = useState('');
    const [importModalSelectedTags, setImportModalSelectedTags] = useState<Set<string>>(new Set());
    const [showImportPreset, setShowImportPreset] = useState(false);
    const [quickImportMode, setQuickImportMode] = useState(true); // 快速导入模式：默认开启，跳过模块选择
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
    const [selectedImportModuleIds, setSelectedImportModuleIds] = useState<Set<string>>(new Set());
    // New: Tab state for import modal
    const [importTab, setImportTab] = useState<'style' | 'character'>('style');

    // --- Favorites (for preset sort), re-read when opening modal ---
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = localStorage.getItem('nai_chain_favs');
            if (saved) setFavorites(new Set(JSON.parse(saved) as string[]));
        } catch { /* ignore */ }
        // Default tab: if I am Character, I likely want to import Artist (style). If I am Artist (style), I likely want Character.
        setImportTab(chain.type === 'character' ? 'style' : 'character');
    }, [showImportPreset, chain.type]);

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
    const keyConfigured = useApiKeyConfigured();
    const [keySheetOpen, setKeySheetOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{
        id: string | null;
        position: 'pre' | 'post';
        edge: 'before' | 'after';
    } | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const [showForkModal, setShowForkModal] = useState(false);
    const [composeOpen, setComposeOpen] = useState(true);
    const [addCharOpen, setAddCharOpen] = useState(false);

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
            ...DEFAULT_NAI_PARAMS,
            model: undefined,
            ...chain.params,
        });
        setChainName(chain.name);
        setChainDesc(chain.description);
        setChainTags(chain.tags || []);
        setGuestHidden(chain.guestHidden || false);
        setIsPrivate(chain.isPrivate || false);

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
        setGeneratedImage(null);
        setErrorMsg(null);

    }, [chain.id, chain.basePrompt, chain.negativePrompt, chain.modules, chain.params, chain.name, chain.description, chain.variableValues, chain.guestHidden, chain.isPrivate]);
    // Dependency note: we still list props to satisfy linter, but the guard 'if (prevChainId === chain.id) return' blocks re-execution.

    // --- sessionStorage 侦听：接收来自历史/灵感页面的一键导入数据 ---
    useEffect(() => {
        const raw = sessionStorage.getItem(IMPORT_SESSION_KEY);
        if (!raw) return;

        try {
            const data = JSON.parse(raw) as { prompt: string; negativePrompt: string; params: NAIParams };
            // 清除标志位，防止重复消费
            sessionStorage.removeItem(IMPORT_SESSION_KEY);
            // 应用数据到当前编辑器
            applyImportData(data);
        } catch (e) {
            console.error('解析 pending import 数据失败', e);
            sessionStorage.removeItem(IMPORT_SESSION_KEY);
        }
    }, [chain.id]); // 仅在编辑器挂载或 chain 切换时消费


    // --- Logic: Compilation ---
    useEffect(() => {
        const tempChain = {
            basePrompt,
            modules: (modules || []).map(m => ({
                ...m,
                isActive: activeModules[m.id] ?? true
            }))
        } as any;

        setFinalPrompt(compilePrompt(tempChain, subjectPrompt));
    }, [basePrompt, modules, activeModules, subjectPrompt]);

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

    const addModule = (position: 'pre' | 'post' = 'post') => {
        if (!canEdit) return;
        const newModule: PromptModule = {
            id: crypto.randomUUID(),
            name: '新模块',
            content: '',
            isActive: true,
            position
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

    const moveModule = (
        fromId: string,
        targetId: string | null,
        position: 'pre' | 'post',
        edge: 'before' | 'after',
    ) => {
        if (!canEdit || fromId === targetId) return;
        const from = modules.findIndex((m) => m.id === fromId);
        if (from < 0) return;
        const next = modules.filter((m) => m.id !== fromId);
        const item: PromptModule = { ...modules[from], position };
        if (targetId) {
            let to = next.findIndex((m) => m.id === targetId);
            if (to < 0) next.push(item);
            else {
                if (edge === 'after') to += 1;
                next.splice(to, 0, item);
            }
        } else if (position === 'pre') {
            const lastPre = next.map((m, i) => ({ m, i })).filter(({ m }) => m.position === 'pre').pop();
            if (lastPre) next.splice(lastPre.i + 1, 0, item);
            else next.unshift(item);
        } else {
            next.push(item);
        }
        setModules(next);
        markChange();
    };

    const onModuleDragStart = (id: string, e: React.DragEvent) => {
        if (!canEdit) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setDraggingId(id);
    };

    const onModuleDragOver = (id: string | null, position: 'pre' | 'post', e: React.DragEvent) => {
        if (!canEdit || !draggingId) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        let edge: 'before' | 'after' = 'after';
        if (id) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            edge = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
        }
        setDropTarget({ id, position, edge });
    };

    const onModuleDrop = (id: string | null, position: 'pre' | 'post', e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const fromId = draggingId || e.dataTransfer.getData('text/plain');
        const edge = dropTarget && dropTarget.position === position && dropTarget.id === id
            ? dropTarget.edge
            : (id ? 'before' : 'after');
        if (fromId) moveModule(fromId, id && id !== fromId ? id : null, position, edge);
        setDraggingId(null);
        setDropTarget(null);
    };

    const onModuleDragEnd = () => {
        setDraggingId(null);
        setDropTarget(null);
    };

    const renderModule = (mod: PromptModule) => {
        const idx = modules.findIndex((m) => m.id === mod.id);
        const position = mod.position === 'pre' ? 'pre' : 'post';
        const isDrop = dropTarget?.id === mod.id && dropTarget.position === position && draggingId !== mod.id;
        return (
            <div
                key={mod.id}
                className={cx(
                    'module-item',
                    activeModules[mod.id] === false && 'opacity-60',
                    draggingId === mod.id && 'is-dragging',
                    isDrop && dropTarget?.edge === 'before' && 'is-drop-before',
                    isDrop && dropTarget?.edge === 'after' && 'is-drop-after',
                )}
                onDragOver={(e) => onModuleDragOver(mod.id, position, e)}
                onDrop={(e) => onModuleDrop(mod.id, position, e)}
            >
                {canEdit ? (
                    <button
                        type="button"
                        className="mod-drag"
                        draggable
                        aria-label={`拖拽 ${mod.name}`}
                        onDragStart={(e) => onModuleDragStart(mod.id, e)}
                        onDragEnd={onModuleDragEnd}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="9" cy="7" r="1.2" fill="currentColor" stroke="none" />
                            <circle cx="15" cy="7" r="1.2" fill="currentColor" stroke="none" />
                            <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
                            <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
                            <circle cx="9" cy="17" r="1.2" fill="currentColor" stroke="none" />
                            <circle cx="15" cy="17" r="1.2" fill="currentColor" stroke="none" />
                        </svg>
                    </button>
                ) : null}
                <Toggle
                    pressed={activeModules[mod.id] !== false}
                    onPressedChange={() => toggleModuleActive(mod.id)}
                    aria-label={`启用 ${mod.name}`}
                />
                <div className="mod-body">
                    <div className="mod-title">
                        <Input className="mod-name" disabled={!canEdit} value={mod.name} onChange={(e) => handleModuleChange(idx, 'name', e.target.value)} />
                        <Input className="mod-group" disabled={!canEdit} placeholder="分组" value={mod.group || ''} onChange={(e) => handleModuleChange(idx, 'group', e.target.value)} />
                    </div>
                    <Textarea disabled={!canEdit} value={mod.content} onChange={(e) => handleModuleChange(idx, 'content', e.target.value)} />
                </div>
                <div className="mod-actions">
                    <Seg
                        className="seg-xs"
                        aria-label={`${mod.name} 位置`}
                        value={position}
                        onChange={(next) => handleModuleChange(idx, 'position', next)}
                        options={[
                            { value: 'pre' as const, label: '前置' },
                            { value: 'post' as const, label: '后置' },
                        ]}
                    />
                    {canEdit && <IconButton size="sm" label="删除模块" onClick={() => removeModule(idx)}><IconClose /></IconButton>}
                </div>
            </div>
        );
    };

    // --- Character Handlers ---
    const addCharacter = (prompt: string) => {
        if (!canEdit) return;
        const newChar: CharacterParams = { id: crypto.randomUUID(), prompt, x: 0.5, y: 0.5 };
        setParams({ ...params, characters: [...(params.characters || []), newChar] });
        setComposeOpen(true);
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
    const getDefaultImportOptions = (c: PromptChain) => {
        // Determine type-based defaults
        const isTargetChar = c.type === 'character';
        const hasModules = c.modules && c.modules.length > 0;

        // Default options based on target type
        return {
            importBasePrompt: !isTargetChar,     // Artist: Checked, Char: Unchecked (per Rule 6 & 5)
            importSubject: isTargetChar,         // Char: Checked, Artist: Unchecked (per Rule 5 & 6)
            importNegative: !isTargetChar,       // Artist: Checked, Char: Unchecked
            importModules: hasModules,           // Both: Checked only if modules exist
            appendModules: false,                // Both: Unchecked
            importCharacters: isTargetChar,      // Char: Checked, Artist: Unchecked
            appendCharacters: false,
            importSettings: !isTargetChar,       // Artist: Checked, Char: Unchecked
            importSeed: false,                   // Both: Unchecked
        };
    };

    const initiateImport = (c: PromptChain) => {
        // 快速导入模式：直接使用默认设置导入，不弹出详细配置
        if (quickImportMode) {
            const defaultOptions = getDefaultImportOptions(c);
            executeImport(c, defaultOptions, new Set((c.modules || []).map(m => m.id)));
            return;
        }

        // 详细模式：弹出配置窗口
        setImportCandidate(c);
        setImportOptions(getDefaultImportOptions(c));
        // Select all modules by default
        setSelectedImportModuleIds(new Set((c.modules || []).map(m => m.id)));
    };

    // 执行导入的核心逻辑（提取为独立函数）
    const executeImport = (
        target: PromptChain,
        options: typeof importOptions,
        moduleIds: Set<string>
    ) => {
        if (!canEdit) return;

        // 1. Prompt (Base + Subject)
        if (options.importBasePrompt) {
            setBasePrompt(target.basePrompt || '');
        }
        if (options.importSubject) {
            const targetSubject = target.variableValues?.['subject'] || '';
            setSubjectPrompt(targetSubject);
        }

        // 2. Negative
        if (options.importNegative) {
            setNegativePrompt(target.negativePrompt || '');
        }

        // 3. Modules
        if (options.importModules && target.modules && target.modules.length > 0) {
            const modulesToImport = target.modules.filter(m => moduleIds.has(m.id));
            const newModules = modulesToImport.map(m => ({ ...m, id: crypto.randomUUID() }));

            if (options.appendModules) {
                setModules(prev => [...prev, ...newModules]); // Append
            } else {
                setModules(newModules); // Replace
            }

            // Update active state
            setActiveModules(prev => {
                const next = options.appendModules ? { ...prev } : {};
                newModules.forEach(m => next[m.id] = m.isActive);
                return next;
            });
        }

        // 4. Characters
        if (options.importCharacters && target.params?.characters) {
            const newChars = target.params.characters.map(c => ({
                ...c,
                id: crypto.randomUUID() // Regen IDs
            }));

            if (options.appendCharacters) {
                setParams(prev => ({ ...prev, characters: [...(prev.characters || []), ...newChars] }));
            } else {
                setParams(prev => ({ ...prev, characters: newChars }));
            }
        }

        // 5. Settings
        if (options.importSettings) {
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
                useCoords: target.params?.useCoords ?? prev.useCoords,
                model: target.params?.model ?? prev.model,
                stream: target.params?.stream ?? prev.stream,
                transparent: target.params?.transparent ?? prev.transparent,
                alphaMode: target.params?.alphaMode ?? prev.alphaMode,
            }));
        }

        // 6. Seed
        if (options.importSeed && target.params?.seed !== undefined) {
            setParams(prev => ({ ...prev, seed: target.params.seed }));
        }

        notify(`已从 "${target.name}" 导入配置`);
        markChange();
        setLoadedPreset(target.name);
        setImportCandidate(null);
        setShowImportPreset(false);
    };

    const confirmImport = () => {
        if (!importCandidate || !canEdit) return;
        executeImport(importCandidate, importOptions, selectedImportModuleIds);
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

        const ok = await confirm({
            title: '用图片参数覆盖当前设置？',
            description: '会覆盖当前 Base Prompt、Negative Prompt 和参数设置。Subject 和模块不会被修改。',
            confirmLabel: '覆盖',
        });
        if (!ok) return;

        try {
            // 调用公共解析服务
            const parsed = parseNovelAIMetadata(rawMeta, params);
            setBasePrompt(parsed.prompt);
            setNegativePrompt(parsed.negativePrompt);
            setParams(parsed.params);
            markChange();
            notify('参数已导入。Quality/UC/Variety 设置已根据 Prompt 内容自动匹配。');
        } catch (e: any) {
            notify('解析失败: ' + e.message, 'error');
        }
        if (importInputRef.current) importInputRef.current.value = '';
    };

    /**
     * 从外部投递的数据（历史/灵感页面的一键导入）中加载参数
     * 由 useEffect 在检测到 sessionStorage 中的 nai_pending_import 时调用
     */
    const applyImportData = (data: { prompt: string; negativePrompt: string; params: NAIParams }) => {
        setBasePrompt(data.prompt);
        setNegativePrompt(data.negativePrompt);
        setParams(data.params);
        markChange();
        notify('已从外部图片导入完整配置。');
    };


    const handleSaveAll = () => {
        if (!isOwner) return;
        const vibeError = validateVibeMounts(params.vibes ?? []);
        if (vibeError) {
            notify(vibeError, 'error');
            return;
        }
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        const varValues = { 'subject': subjectPrompt };
        onUpdateChain(chain.id, {
            name: chainName,
            description: chainDesc,
            tags: chainTags,
            guestHidden,
            isPrivate,
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
        setShowForkModal(true);
    };

    const handleReset = async () => {
        const ok = await confirm({
            title: '确定要重置实验室吗？',
            description: '所有当前输入都将丢失。',
            confirmLabel: '重置',
            tone: 'danger',
        });
        if (!ok) return;
        setChainName('生图实验室');
        setChainDesc('临时生图实验，点击保存为串可写入列表');
        setBasePrompt('');
        setNegativePrompt(''); // keep empty for playground
        // Reset params to defaults
        setParams({ ...DEFAULT_NAI_PARAMS, vibes: [] });
        setSubjectPrompt('');
        setModules([]);
        setActiveModules({});
        setGeneratedImage(null);
        notify('实验室已重置');
    };

    const confirmFork = (targetType: 'style' | 'character', name?: string, description?: string) => {
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        onFork({
            ...chain,
            name: name ?? chain.name,
            description: description ?? chain.description,
            tags: chainTags,
            basePrompt,
            negativePrompt,
            modules: updatedModules,
            params,
            variableValues: { 'subject': subjectPrompt }
        }, targetType);
        setShowForkModal(false);
    };

    const toggleModuleActive = (id: string) => {
        setActiveModules(prev => {
            const newState = { ...prev, [id]: !prev[id] };

            // Group Logic: If activating, deactivate others in same group
            if (newState[id]) {
                const targetMod = modules.find(m => m.id === id);
                if (targetMod && targetMod.group) {
                    modules.forEach(m => {
                        if (m.id !== id && m.group === targetMod.group && prev[m.id]) {
                            newState[m.id] = false;
                        }
                    });
                }
            }

            markChange();
            return newState;
        });
    };

    const handleGenerate = async () => {
        const apiKey = getApiKey();
        if (!apiKey) {
            setErrorMsg('请先配置 NovelAI API Key');
            setKeySheetOpen(true);
            return;
        }
        setIsGenerating(true);
        setErrorMsg(null);
        try {
            const activeParams = { ...params };
            const vibeMounts = activeParams.vibes ?? [];
            const vibePresets = vibeMounts.length === 0
                ? []
                : (await Promise.all(vibeMounts.map(mount => vibeLibrary.get(mount.vibeId))))
                    .filter(preset => preset !== undefined);
            const resolvedVibes = resolveVibeMounts(vibeMounts, vibePresets);
            let result;
            if (activeParams.stream) {
                try {
                    result = await generateImageStream(
                        apiKey,
                        finalPrompt,
                        negativePrompt,
                        activeParams,
                        resolvedVibes,
                        (preview) => setGeneratedImage(preview),
                    );
                } catch (streamErr) {
                    console.warn('流式生成失败，回退 zip 接口:', streamErr);
                    result = await generateImage(apiKey, finalPrompt, negativePrompt, activeParams, resolvedVibes);
                }
            } else {
                result = await generateImage(apiKey, finalPrompt, negativePrompt, activeParams, resolvedVibes);
            }
            setGeneratedImage(result.image);
            // Use actual seed returned from generation
            const finalParams = { ...activeParams, seed: result.seed };
            // 自动 JPG 保存：开启时在入库前把 PNG 转码为 JPG（仅作用于本地历史记录）
            // 失败时回退到原 PNG，绝不阻塞主流程 —— 元数据始终走 prompt/params 独立字段
            // 仅 V5 透明背景需要保留 alpha；NAI 默认 RGBA PNG 不能当跳过依据
            let finalImage = result.image;
            const preserveAlpha = !!activeParams.transparent && isV5Model(activeParams);
            if (shouldApplyAutoJpgSave({
                enabled: localStorage.getItem('naipm.compaction.autoJpg') === 'true',
                preserveAlpha,
            })) {
                try {
                    const q = parseFloat(localStorage.getItem('naipm.compaction.quality') || '0.85');
                    const quality = isNaN(q) ? 0.85 : Math.min(1, Math.max(0.01, q));
                    const { jpgDataUri } = await compressPngToJpg(result.image, quality);
                    finalImage = jpgDataUri;
                } catch (err) {
                    console.warn('自动 JPG 保存失败，回退为 PNG 入库:', err);
                }
            }
            await localHistory.add(finalImage, finalPrompt, finalParams);
            void refreshNaiAccount();
        } catch (e: any) {
            setErrorMsg(e.message);
            notify(e.message, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSavePreview = async () => {
        if (!generatedImage || !isOwner || chain.id === 'playground') return;
        const ok = await confirm({
            title: '设为封面图？',
            description: '此操作将永久删除旧的封面图（如果是上传的图片）。',
            confirmLabel: '设为封面',
            tone: 'danger',
        });
        if (!ok) return;
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
    };

    const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!isOwner) return;
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const ok = await confirm({
            title: '上传新封面？',
            description: '此操作将永久删除旧的封面图文件。',
            confirmLabel: '替换封面',
            tone: 'danger',
        });
        if (!ok) return;
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
        <div className="editor-shell">
            <header className="page-head">
                <div className="page-head-title">
                    <IconButton label="返回看板" onClick={onBack}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                    </IconButton>
                    <h1>
                        {chain.id === 'playground' ? '生图实验室' : '串编辑器'}
                        {hasChanges && <i className="dirty-dot" title="未保存" />}
                    </h1>
                </div>
                <div className="head-actions">
                    {chain.id === 'playground' && (
                        <Button size="sm" onClick={handleFork}>保存为串</Button>
                    )}
                    {!isOwner && !isGuest && chain.id !== 'playground' && (
                        <Button variant="secondary" size="sm" onClick={handleFork}>Fork</Button>
                    )}
                    {chain.id === 'playground' && (
                        <Button variant="ghost" size="sm" onClick={handleReset}>重置</Button>
                    )}
                    {isOwner && chain.id !== 'playground' && (
                        <Button size="sm" disabled={!hasChanges} onClick={handleSaveAll}>保存</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setKeySheetOpen(true)}>
                        {keyConfigured ? 'API Key' : '设置 API Key'}
                    </Button>
                </div>
            </header>

            {!isOwner && (
                <p className="hint">
                    {isGuest
                        ? '游客可以改 Prompt 试跑，但不能保存。'
                        : '正在查看他人的串。可试跑，或 Fork 到自己的列表。'}
                </p>
            )}

            <div className="editor-layout">
                <div className="stack">
                    {chain.id !== 'playground' && (
                    <Collapse title="基础信息" defaultOpen={Math.abs((chain.updatedAt ?? 0) - (chain.createdAt ?? 0)) < 2000}>
                        <div className="stack">
                            <Field label="名称">
                                <Input value={chainName} disabled={!canEdit} onChange={(e) => { setChainName(e.target.value); markChange(); }} />
                            </Field>
                            <Field label="描述">
                                <Input value={chainDesc} disabled={!canEdit} onChange={(e) => { setChainDesc(e.target.value); markChange(); }} />
                            </Field>
                            <Field label="类型">
                                <Select disabled value={isCharacterMode ? 'character' : 'style'}>
                                    <option value="style">画师串</option>
                                    <option value="character">角色串</option>
                                </Select>
                            </Field>
                            {isOwner && chain.id !== 'playground' && (
                                <Field label="可见性">
                                    <div className="vis-rows surface">
                                        <div className="vis-row">
                                            <span>游客不可见</span>
                                            <Toggle pressed={guestHidden} onPressedChange={(on) => { setGuestHidden(on); markChange(); }} aria-label="游客不可见" />
                                        </div>
                                        {(currentUser.role === 'vip' || currentUser.role === 'admin') && (
                                            <div className="vis-row">
                                                <span>私人串</span>
                                                <Toggle pressed={isPrivate} onPressedChange={(on) => { setIsPrivate(on); markChange(); }} aria-label="私人串" />
                                            </div>
                                        )}
                                    </div>
                                </Field>
                            )}
                            <div className="chips">
                                {chainTags.map((tag, idx) => (
                                    <span key={tag + idx} className="chip chip-soft">
                                        {tag}
                                        {canEdit && (
                                            <button type="button" className="icon-btn sm" aria-label={`移除标签 ${tag}`} onClick={() => { setChainTags(chainTags.filter((_, i) => i !== idx)); markChange(); }}>
                                                <IconClose className="icon-xs" />
                                            </button>
                                        )}
                                    </span>
                                ))}
                                {canEdit && (
                                    <input
                                        className="chip"
                                        placeholder="+ 标签"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                const next = e.currentTarget.value.trim();
                                                if (!chainTags.includes(next)) {
                                                    setChainTags([...chainTags, next]);
                                                    markChange();
                                                }
                                                e.currentTarget.value = '';
                                            }
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    </Collapse>
                    )}

                    <Collapse
                        title="提示词结构"
                        defaultOpen
                        extra={canEdit ? (
                            <>
                                {loadedPreset && <Tag tone="sage">PRESET {loadedPreset}</Tag>}
                                <Button variant="ghost" size="sm" onClick={() => setShowImportPreset(true)}>引用预设</Button>
                                <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>导入图片</Button>
                                <Button variant="ghost" size="sm" onClick={() => addModule('post')}>+ 模块</Button>
                                <input type="file" ref={importInputRef} className="hidden" accept="image/png" onChange={handleImportImage} />
                            </>
                        ) : null}
                    >
                        <div className="stack">
                            <Field label="基础画风">
                                <Textarea
                                    disabled={!canEdit}
                                    value={basePrompt}
                                    placeholder="画风标签，英文逗号分隔"
                                    onChange={(e) => { setBasePrompt(e.target.value); markChange(); }}
                                />
                            </Field>
                            <Field label="主体">
                                <Textarea
                                    value={subjectPrompt}
                                    placeholder="1girl, looking at viewer"
                                    onChange={(e) => { setSubjectPrompt(e.target.value); markChange(); }}
                                />
                            </Field>
                            <p className="param-group-label">前置模块</p>
                            <div
                                className={cx(
                                    'module-list',
                                    (modules || []).every((m) => m.position !== 'pre') && 'is-empty',
                                    dropTarget?.position === 'pre' && !dropTarget.id && 'is-drop-empty',
                                )}
                                onDragOver={(e) => onModuleDragOver(null, 'pre', e)}
                                onDrop={(e) => onModuleDrop(null, 'pre', e)}
                            >
                                {(modules || []).filter((m) => m.position === 'pre').map(renderModule)}
                            </div>
                            <p className="param-group-label">后置模块</p>
                            <div
                                className={cx(
                                    'module-list',
                                    (modules || []).every((m) => m.position === 'pre') && 'is-empty',
                                    dropTarget?.position === 'post' && !dropTarget.id && 'is-drop-empty',
                                )}
                                onDragOver={(e) => onModuleDragOver(null, 'post', e)}
                                onDrop={(e) => onModuleDrop(null, 'post', e)}
                            >
                                {(modules || []).filter((m) => m.position !== 'pre').map(renderModule)}
                            </div>
                            <Field label="全局负面提示词">
                                <Textarea
                                    className="textarea-neg"
                                    disabled={!canEdit}
                                    value={negativePrompt}
                                    onChange={(e) => { setNegativePrompt(e.target.value); markChange(); }}
                                />
                            </Field>
                        </div>
                    </Collapse>

                    <ChainEditorParams
                        params={params}
                        setParams={setParams}
                        canEdit={canEdit}
                        markChange={markChange}
                        notify={notify}
                        compositionOpen={composeOpen}
                        onCompositionOpenChange={setComposeOpen}
                        compositionExtra={(
                            <>
                                <Chip
                                    active={!!params.useCoords}
                                    disabled={!canEdit}
                                    onClick={() => { setParams({ ...params, useCoords: !params.useCoords }); markChange(); }}
                                >
                                    手动坐标
                                </Chip>
                                {canEdit && <Button variant="ghost" size="sm" onClick={() => setAddCharOpen(true)}>+ 角色</Button>}
                            </>
                        )}
                        compositionBody={(
                            <div className="stack">
                                {(params.characters || []).length === 0 && (
                                    <p className="hint">暂无角色定义，提示词将作为整体处理。</p>
                                )}
                                {(params.characters || []).map((char, idx) => (
                                    <div key={char.id} className="module-item char-item">
                                        <div className="mod-body stack" style={{ gap: 8 }}>
                                            <Field label={`角色 ${idx + 1} 提示词`}>
                                                <Textarea disabled={!canEdit} value={char.prompt} onChange={(e) => updateCharacter(idx, { prompt: e.target.value })} />
                                            </Field>
                                            <Field label="专属负面">
                                                <Textarea disabled={!canEdit} value={char.negativePrompt || ''} onChange={(e) => updateCharacter(idx, { negativePrompt: e.target.value })} />
                                            </Field>
                                            <div className={cx('param-grid', 'coord-fields', !params.useCoords && 'is-off')}>
                                                <Field label="Center X">
                                                    <Input type="number" step="0.1" min={0} max={1} disabled={!canEdit || !params.useCoords} value={char.x} onChange={(e) => updateCharacter(idx, { x: parseFloat(e.target.value) })} />
                                                </Field>
                                                <Field label="Center Y">
                                                    <Input type="number" step="0.1" min={0} max={1} disabled={!canEdit || !params.useCoords} value={char.y} onChange={(e) => updateCharacter(idx, { y: parseFloat(e.target.value) })} />
                                                </Field>
                                            </div>
                                        </div>
                                        {canEdit && <IconButton size="sm" label="删除角色" onClick={() => removeCharacter(idx)}><IconClose /></IconButton>}
                                    </div>
                                ))}
                            </div>
                        )}
                    />

                    <Collapse title="参考风格" defaultOpen>
                        <ChainEditorVibePanel
                            params={params}
                            setParams={setParams}
                            canEdit={canEdit}
                            markChange={markChange}
                            notify={notify}
                        />
                    </Collapse>
                </div>

                <ChainEditorPreview
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
                    hideCoverActions={chain.id === 'playground'}
                    transparentPreview={!!params.transparent && isV5Model(params)}
                    stream={!!params.stream}
                    streamDisabled={!canEdit}
                    onToggleStream={() => {
                        if (!canEdit) return;
                        setParams({ ...params, stream: !params.stream });
                        markChange();
                    }}
                />
            </div>

            {lightboxImg && (
                <Portal>
                    <div className="lbx" onClick={() => setLightboxImg(null)}>
                        <img src={lightboxImg} alt="" className={dataUriHasAlpha(lightboxImg) ? 'checker' : undefined} onClick={e => e.stopPropagation()} />
                        <button type="button" className="lbx-close icon-btn" aria-label="关闭" onClick={() => setLightboxImg(null)}>
                            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                    </div>
                </Portal>
            )}

            {/* Import Preset List Modal */}
            {showImportPreset && !importCandidate && (
                <Portal>
                <div className="modal-layer" onClick={() => setShowImportPreset(false)}>
                    <div className="modal-card bg-white dark:bg-gray-800 rounded-xl w-full max-w-4xl md:max-w-5xl lg:max-w-6xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center flex-shrink-0 gap-4 flex-wrap">
                            <h3 className="font-bold dark:text-white flex-shrink-0">引用预设</h3>

                            {/* 快速导入开关 */}
                            <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0 group">
                                <span className="text-xs text-gray-500 dark:text-gray-400">快速导入</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={quickImportMode}
                                    onClick={() => setQuickImportMode(!quickImportMode)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setQuickImportMode(!quickImportMode); } }}
                                    className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${quickImportMode ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                                >
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${quickImportMode ? 'left-5' : 'left-0.5'}`}></div>
                                </button>
                                <span className="relative">
                                    <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                        开启后点击预设直接导入，关闭则显示详细选项
                                    </span>
                                </span>
                            </label>

                            <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg flex-1 max-w-xs">
                                <button
                                    onClick={() => setImportTab('style')}
                                    className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${importTab === 'style' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500'}`}
                                >
                                    画师/风格串
                                </button>
                                <button
                                    onClick={() => setImportTab('character')}
                                    className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${importTab === 'character' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500'}`}
                                >
                                    Character (角色)
                                </button>
                            </div>

                            <button onClick={() => setShowImportPreset(false)} className="icon-btn" aria-label="关闭"><IconClose /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 min-h-0">
                            {/* Extract all unique tags from the filtered list for this modal */}
                            {(() => {
                              const filteredForTags = allChains.filter(c => (importTab === 'character' ? c.type === 'character' : (c.type === 'style' || !c.type)));
                              const allModalTags = Array.from(
                                new Set(
                                  filteredForTags.flatMap(chain => chain.tags || [])
                                )
                              ).sort();

                              // Filter the list based on search and tags
                              const filteredChains = filteredForTags
                                .filter(c =>
                                  (c.name.toLowerCase().includes(importModalSearch.toLowerCase()) ||
                                   c.description.toLowerCase().includes(importModalSearch.toLowerCase()))
                                )
                                .filter(c => {
                                  if (importModalSelectedTags.size === 0) return true;
                                  const chainTagSet = new Set(c.tags || []);
                                  return Array.from(importModalSelectedTags).every(tag => chainTagSet.has(tag));
                                })
                                .sort((a, b) => {
                                  const aFav = favorites.has(a.id); const bFav = favorites.has(b.id);
                                  if (aFav && !bFav) return -1; if (!aFav && bFav) return 1; return 0;
                                });

                              return (
                                <>
                                  {/* Search Input for Modal */}
                                  <div className="flex gap-2 w-full mb-4">
                                    <input
                                      type="text"
                                      placeholder="搜索预设..."
                                      className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                      value={importModalSearch}
                                      onChange={(e) => setImportModalSearch(e.target.value)}
                                    />
                                  </div>
                                  {/* Tag Filter Bar for Modal */}
                                  {allModalTags.length > 0 && (
                                    <div className="flex flex-wrap gap-2 p-2 bg-gray-100 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 mb-4 max-h-20 overflow-y-auto">
                                      {allModalTags.map(tag => (
                                        <button
                                          key={tag}
                                          type="button"
                                          onClick={() => {
                                            const newSelected = new Set(importModalSelectedTags);
                                            if (newSelected.has(tag)) {
                                              newSelected.delete(tag);
                                            } else {
                                              newSelected.add(tag);
                                            }
                                            setImportModalSelectedTags(newSelected);
                                          }}
                                          className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                                            importModalSelectedTags.has(tag)
                                              ? 'bg-indigo-600 text-white'
                                              : 'bg-white dark:bg-gray-600 text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-500'
                                          }`}
                                        >
                                          {tag}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                    {filteredChains.map(c => (
                                      <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => initiateImport(c)}
                                        className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 bg-white dark:bg-gray-800/80 overflow-hidden text-left transition-colors"
                                      >
                                        <div className="aspect-square w-full bg-black/5 dark:bg-black/20 flex-shrink-0 relative">
                                          {c.previewImage ? (
                                            <img src={c.previewImage} alt="" className="absolute inset-0 w-full h-full object-contain" />
                                          ) : (
                                            <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">无图</div>
                                          )}
                                          {favorites.has(c.id) && (
                                            <span className="absolute top-1 right-1 text-amber-500 text-lg drop-shadow-md" title="已收藏">★</span>
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
                                  {filteredChains.length === 0 && (
                                    <div className="text-center text-gray-400 py-12 text-sm">暂无匹配的预设</div>
                                  )}
                                </>
                              );
                            })()}
                        </div>
                    </div>
                </div>
                </Portal>
            )}

            {/* Import Detail/Confirm Modal */}
            {importCandidate && (
                <Portal>
                <div className="modal-layer" onClick={() => setImportCandidate(null)}>
                    <div className="modal-card bg-white dark:bg-gray-800 rounded-xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-t-xl">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate" title={importCandidate.name}>
                                导入: {importCandidate.name}
                            </h3>
                        </div>
                        <div className="p-5 space-y-3">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importBasePrompt} onChange={e => setImportOptions({ ...importOptions, importBasePrompt: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">基础画风</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSubject} onChange={e => setImportOptions({ ...importOptions, importSubject: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">主体提示词</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importNegative} onChange={e => setImportOptions({ ...importOptions, importNegative: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">负面提示词</span>
                            </label>

                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={importOptions.importModules} onChange={e => setImportOptions({ ...importOptions, importModules: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-sm font-medium dark:text-gray-200">增强模块</span>
                                </label>
                                {importOptions.importModules && (
                                    <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                        <input type="checkbox" checked={importOptions.appendModules} onChange={e => setImportOptions({ ...importOptions, appendModules: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">追加</span>
                                    </label>
                                )}
                                {importOptions.importModules && importCandidate.modules && importCandidate.modules.length > 0 && (
                                    <div className="ml-8 mt-2 border border-gray-200 dark:border-gray-700 rounded p-2 max-h-40 overflow-y-auto bg-gray-50 dark:bg-gray-900 custom-scrollbar">
                                        {importCandidate.modules.map(m => (
                                            <label key={m.id} className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 p-1 rounded cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedImportModuleIds.has(m.id)}
                                                    onChange={e => {
                                                        const next = new Set(selectedImportModuleIds);
                                                        if (e.target.checked) next.add(m.id);
                                                        else next.delete(m.id);
                                                        setSelectedImportModuleIds(next);
                                                    }}
                                                    className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-0 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                                                />
                                                <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1" title={m.content}>{m.name || '未命名模块'}</span>
                                                {m.group && <span className="text-[9px] bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded text-gray-500 uppercase">{m.group}</span>}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={importOptions.importCharacters} onChange={e => setImportOptions({ ...importOptions, importCharacters: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-sm font-medium dark:text-gray-200">多角色管理</span>
                                </label>
                                {importOptions.importCharacters && (
                                    <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                        <input type="checkbox" checked={importOptions.appendCharacters} onChange={e => setImportOptions({ ...importOptions, appendCharacters: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">追加</span>
                                    </label>
                                )}
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSettings} onChange={e => setImportOptions({ ...importOptions, importSettings: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">生成参数</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSeed} onChange={e => setImportOptions({ ...importOptions, importSeed: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">种子</span>
                            </label>
                        </div>
                        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                            <button onClick={() => setImportCandidate(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">取消</button>
                            <button onClick={confirmImport} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded shadow-lg shadow-indigo-500/20 transition-all">导入</button>
                        </div>
                    </div>
                </div>
                </Portal>
            )}
            {chain.id === 'playground' ? (
                <SaveAsChainSheet
                    open={showForkModal}
                    onClose={() => setShowForkModal(false)}
                    onConfirm={(name, description, type) => confirmFork(type, name, description)}
                />
            ) : showForkModal && (
                <Portal>
                <div className="modal-layer" onClick={() => setShowForkModal(false)}>
                    <div className="modal-card bg-white dark:bg-gray-800 rounded-xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700 p-6" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">选择保存类型</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => confirmFork('style')}
                                className="fork-type flex flex-col items-center justify-center p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors gap-2"
                            >
                                <IconPalette className="w-8 h-8" />
                                <span className="font-bold text-blue-700 dark:text-blue-300">画师/风格串</span>
                            </button>
                            <button
                                onClick={() => confirmFork('character')}
                                className="fork-type flex flex-col items-center justify-center p-4 rounded-lg bg-pink-50 dark:bg-pink-900/20 border-2 border-pink-200 dark:border-pink-800 hover:bg-pink-100 dark:hover:bg-pink-900/40 transition-colors gap-2"
                            >
                                <IconUser className="w-8 h-8" />
                                <span className="font-bold text-pink-700 dark:text-pink-300">角色串</span>
                            </button>
                        </div>
                        <button
                            onClick={() => setShowForkModal(false)}
                            className="mt-6 w-full py-2 text-gray-500 hover:text-gray-800 dark:hover:text-white text-sm font-medium"
                        >
                            取消
                        </button>
                    </div>
                </div>
                </Portal>
            )}
            <AddCharacterPicker
                open={addCharOpen}
                onClose={() => setAddCharOpen(false)}
                onPick={addCharacter}
            />
            <ApiKeySheet open={keySheetOpen} onClose={() => setKeySheetOpen(false)} />
        </div>
    );
};
