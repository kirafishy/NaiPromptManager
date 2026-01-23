
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PromptChain, PromptModule, User, CharacterParams } from '../types';
import { compilePrompt } from '../services/promptUtils';
import { generateImage } from '../services/naiService';
import { localHistory } from '../services/localHistory';
import { api } from '../services/api';
import { extractMetadata } from '../services/metadataService';

interface ChainEditorProps {
  chain: PromptChain;
  currentUser: User;
  onUpdateChain: (id: string, updates: Partial<PromptChain>) => void;
  onBack: () => void;
  onFork: (chain: PromptChain) => void;
  setIsDirty: (isDirty: boolean) => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

const RESOLUTIONS = {
  Portrait: { width: 832, height: 1216, label: "竖屏 (832x1216)" },
  Landscape: { width: 1216, height: 832, label: "横屏 (1216x832)" },
  Square: { width: 1024, height: 1024, label: "方形 (1024x1024)" },
};

export const ChainEditor: React.FC<ChainEditorProps> = ({ chain, currentUser, onUpdateChain, onBack, onFork, setIsDirty, notify }) => {
  // Permission Check
  // Guests are strictly viewers but allowed to try generation.
  const isGuest = currentUser.role === 'guest';
  const isOwner = !isGuest && (chain.userId === currentUser.id || currentUser.role === 'admin');

  // --- Chain Info State ---
  const [chainName, setChainName] = useState(chain.name);
  const [chainDesc, setChainDesc] = useState(chain.description);
  const [isEditingInfo, setIsEditingInfo] = useState(false);

  // --- Prompt State ---
  const [basePrompt, setBasePrompt] = useState(chain.basePrompt || '');
  const [negativePrompt, setNegativePrompt] = useState(chain.negativePrompt || '');
  const [modules, setModules] = useState<PromptModule[]>(chain.modules || []);
  const [params, setParams] = useState(chain.params || { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 0, qualityToggle: true, ucPreset: 0 });
  
  // --- New: Subject/Variable Prompt State ---
  const [subjectPrompt, setSubjectPrompt] = useState('');
  
  const [hasChanges, setHasChanges] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  // Sync dirty state with parent
  useEffect(() => {
    setIsDirty(hasChanges);
  }, [hasChanges, setIsDirty]);

  // --- Testing State ---
  const [activeModules, setActiveModules] = useState<Record<string, boolean>>({});
  const [finalPrompt, setFinalPrompt] = useState('');
  
  // --- Generation State ---
  const [apiKey, setApiKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  
  // --- Initialization ---
  useEffect(() => {
    setBasePrompt(chain.basePrompt || '');
    setNegativePrompt(chain.negativePrompt || '');
    setModules((chain.modules || []).map(m => ({
        ...m,
        position: m.position || 'post'
    })));
    setParams({
        width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 0, 
        qualityToggle: true, ucPreset: 0, characters: [],
        ...chain.params
    });
    setChainName(chain.name);
    setChainDesc(chain.description);
    
    const savedVars = chain.variableValues || {};
    setSubjectPrompt(savedVars['subject'] || '1girl');
    
    const initialModules: Record<string, boolean> = {};
    if (chain.modules) {
      chain.modules.forEach(m => {
        initialModules[m.id] = m.isActive;
      });
    }
    setActiveModules(initialModules);
    setHasChanges(false);

    // Load API Key for everyone, including guests if they saved it locally
    const savedKey = localStorage.getItem('nai_api_key');
    if (savedKey) setApiKey(savedKey);

  }, [chain, isGuest]);

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

  // --- Handlers: Prompt Editing ---
  const handleModuleChange = (index: number, key: keyof PromptModule, value: any) => {
    if (!isOwner) return;
    const newModules = [...modules];
    newModules[index] = { ...newModules[index], [key]: value };
    setModules(newModules);
    setHasChanges(true);
  };

  const addModule = () => {
    if (!isOwner) return;
    const newModule: PromptModule = {
      id: crypto.randomUUID(),
      name: '新模块',
      content: '',
      isActive: true,
      position: 'post'
    };
    setModules([...modules, newModule]);
    setActiveModules(prev => ({ ...prev, [newModule.id]: true }));
    setHasChanges(true);
  };

  const removeModule = (index: number) => {
    if (!isOwner) return;
    const newModules = [...modules];
    newModules.splice(index, 1);
    setModules(newModules);
    setHasChanges(true);
  };

  const handleResolutionChange = (mode: string) => {
    if (!isOwner && mode !== 'Custom') return;
    if (isOwner) {
        if (mode === 'Custom') return;
        const res = RESOLUTIONS[mode as keyof typeof RESOLUTIONS];
        setParams({ ...params, width: res.width, height: res.height });
        setHasChanges(true);
    }
  };

  const getCurrentResolutionMode = () => {
    const w = params.width;
    const h = params.height;
    if (w === 832 && h === 1216) return 'Portrait';
    if (w === 1216 && h === 832) return 'Landscape';
    if (w === 1024 && h === 1024) return 'Square';
    return '';
  };

  // --- Character Handlers ---
  const addCharacter = () => {
      if (!isOwner) return;
      const newChar: CharacterParams = { id: crypto.randomUUID(), prompt: "character description", x: 0.5, y: 0.5 };
      setParams({ ...params, characters: [...(params.characters || []), newChar] });
      setHasChanges(true);
  };

  const updateCharacter = (idx: number, updates: Partial<CharacterParams>) => {
      if (!isOwner || !params.characters) return;
      const newChars = [...params.characters];
      newChars[idx] = { ...newChars[idx], ...updates };
      setParams({ ...params, characters: newChars });
      setHasChanges(true);
  };

  const removeCharacter = (idx: number) => {
      if (!isOwner || !params.characters) return;
      const newChars = [...params.characters];
      newChars.splice(idx, 1);
      setParams({ ...params, characters: newChars });
      setHasChanges(true);
  };

  // --- Import Logic ---
  const handleImportImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isOwner) return;
      const file = e.target.files?.[0];
      if (!file) return;

      const rawMeta = await extractMetadata(file);
      if (!rawMeta) {
          notify('无法读取图片信息或非 PNG 图片', 'error');
          return;
      }

      if (!confirm('是否用该图片的参数覆盖当前 Base Prompt、Negative Prompt 和参数设置？\n(Subject 和 模块不会被修改)')) return;

      try {
          // Attempt to parse standard NAI text format first
          let prompt = rawMeta;
          let negative = '';
          let newParams: any = { ...params };

          // 1. Try JSON parse (metadata is JSON in the provided format)
          if (rawMeta.trim().startsWith('{')) {
              try {
                  const json = JSON.parse(rawMeta);
                  
                  // Basic Mapping
                  if (json.prompt) prompt = json.prompt;
                  if (json.uc) negative = json.uc; 
                  if (json.steps) newParams.steps = json.steps;
                  if (json.scale) newParams.scale = json.scale;
                  if (json.seed) newParams.seed = json.seed;
                  if (json.sampler) newParams.sampler = json.sampler;
                  
                  if (json.width) newParams.width = json.width;
                  if (json.height) newParams.height = json.height;

                  // V4.5 Fields Mapping
                  if (json.qualityToggle !== undefined) newParams.qualityToggle = json.qualityToggle;
                  if (json.ucPreset !== undefined) newParams.ucPreset = json.ucPreset;
                  
                  // V4 Prompt (Characters)
                  if (json.v4_prompt) {
                      const v4 = json.v4_prompt;
                      if (v4.caption?.base_caption) {
                          prompt = v4.caption.base_caption;
                      }
                      if (v4.caption?.char_captions && Array.isArray(v4.caption.char_captions)) {
                          newParams.characters = v4.caption.char_captions.map((cc: any) => ({
                              id: crypto.randomUUID(),
                              prompt: cc.char_caption || '',
                              x: cc.centers?.[0]?.x ?? 0.5,
                              y: cc.centers?.[0]?.y ?? 0.5
                          }));
                      }
                  } else {
                      // Reset characters if importing a non-V4 image? 
                      // Or keep? Let's reset to match the image exactly.
                      newParams.characters = [];
                  }

              } catch(e) {
                  console.error("JSON parse error despite starting with {", e);
                  // Fallback to text parsing if JSON parse fails
              }
          } else {
              // Not JSON, fall back to legacy text parsing
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
                  
                  const endOfPrompts = stepsIndex;
                  if (negIndex !== -1 && negIndex < stepsIndex) {
                      prompt = rawMeta.substring(0, negIndex).trim();
                      negative = rawMeta.substring(negIndex + 16, stepsIndex).trim();
                  } else {
                      prompt = rawMeta.substring(0, stepsIndex).trim();
                  }
              }
          }

          setBasePrompt(prompt);
          setNegativePrompt(negative);
          setParams(newParams);
          setHasChanges(true);
          notify('参数已导入 (包含 V4 设置)');
      } catch (e: any) {
          notify('解析失败: ' + e.message, 'error');
      }
      
      // Reset input
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
      notify('画师串已保存');
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
        if (isOwner) setHasChanges(true);
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
        // 0 means random, but for generateImage we pass it as is (logic handled in service)
        
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
    if(confirm('将当前生成的图片设为该画师串的封面图？\n\n警告：此操作将永久删除旧的封面图（如果是上传的图片）。')) {
        setIsUploading(true);
        try {
            const res = await fetch(generatedImage);
            const blob = await res.blob();
            const file = new File([blob], getDownloadFilename(), { type: 'image/png' });

            const uploadRes = await api.uploadFile(file, 'covers');
            await onUpdateChain(chain.id, { previewImage: uploadRes.url });
            notify('封面已更新 (刷新列表查看效果)');
        } catch(e: any) {
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

      if(confirm('您确定要上传新封面吗？\n\n警告：此操作将永久删除旧的封面图文件。')) {
          setIsUploading(true);
          try {
              const res = await api.uploadFile(file, 'covers');
              await onUpdateChain(chain.id, { previewImage: res.url });
              notify('封面已更新');
          } catch(err: any) {
              notify('上传失败: ' + err.message, 'error');
          } finally {
              setIsUploading(false);
          }
      } else {
          if (fileInputRef.current) fileInputRef.current.value = '';
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
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          
          {isEditingInfo && isOwner ? (
              <div className="flex flex-col md:flex-row gap-2 flex-1 w-full max-w-2xl min-w-0">
                  <input type="text" value={chainName} onChange={e => {setChainName(e.target.value); setHasChanges(true)}} className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-900 dark:text-white text-sm focus:border-indigo-500 outline-none font-bold min-w-0" placeholder="名称" />
                  <div className="flex gap-2">
                    <input type="text" value={chainDesc} onChange={e => {setChainDesc(e.target.value); setHasChanges(true)}} className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-300 text-sm focus:border-indigo-500 outline-none min-w-0" placeholder="描述" />
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
                    title="复制完整正面 Prompt"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                </button>
                <button 
                    onClick={() => copyPromptToClipboard(true)} 
                    className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                    title="复制负面 Prompt"
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
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
          {/* Left Panel - Editor */}
          <div className="w-full lg:w-1/2 flex flex-col border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800 lg:overflow-y-auto bg-white dark:bg-gray-900 relative order-2 lg:order-1 lg:flex-1 shrink-0">
              <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full pb-32 md:pb-24">
                  {!isOwner && (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded mb-4 text-sm text-yellow-700 dark:text-yellow-400">
                          {isGuest 
                            ? '您正在以游客身份浏览，无法保存修改。请在右上角填入 API Key 进行生图测试。'
                            : '您正在查看他人的画师串，无法直接修改。您可以调整参数进行测试，或点击右上角“Fork”保存到您的列表。'
                          }
                      </div>
                  )}

                  {/* Base Prompt */}
                  <section>
                    <div className="flex justify-between items-end mb-2">
                        <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">1. 基础场景/背景 (Base)</label>
                        {/* Import Button */}
                        {isOwner && (
                            <div>
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
                                    导入配置
                                </button>
                            </div>
                        )}
                    </div>
                    <textarea
                      disabled={!isOwner}
                      className={`w-full border rounded-lg p-3 outline-none font-mono text-sm leading-relaxed min-h-[100px] ${!isOwner ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-indigo-500'}`}
                      value={basePrompt}
                      placeholder="e.g. outdoors, sky, clouds, masterpiece, best quality"
                      onChange={(e) => {setBasePrompt(e.target.value); setHasChanges(true)}}
                    />
                  </section>

                   {/* Modules */}
                  <section>
                    <div className="flex justify-between items-center mb-3">
                        <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">2. 风格模块 (Modules)</label>
                        {isOwner && (
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
                                        disabled={!isOwner}
                                        className="bg-transparent border-b border-transparent focus:border-indigo-500 text-indigo-600 dark:text-indigo-300 font-medium text-sm outline-none px-1 flex-1 min-w-[120px]"
                                        value={mod.name}
                                        onChange={(e) => handleModuleChange(idx, 'name', e.target.value)}
                                    />
                                    <div className="flex bg-gray-200 dark:bg-gray-700 rounded p-0.5 ml-auto flex-shrink-0">
                                        <button 
                                            onClick={() => handleModuleChange(idx, 'position', 'pre')}
                                            disabled={!isOwner}
                                            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mod.position === 'pre' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                        >
                                            前置
                                        </button>
                                        <button 
                                            onClick={() => handleModuleChange(idx, 'position', 'post')}
                                            disabled={!isOwner}
                                            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${(mod.position === 'post' || !mod.position) ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                        >
                                            后置
                                        </button>
                                    </div>
                                    {isOwner && (
                                        <button onClick={() => removeModule(idx)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                    )}
                                </div>
                                <textarea
                                    disabled={!isOwner}
                                    className={`w-full rounded p-2 outline-none font-mono text-xs h-16 resize-none ${!isOwner ? 'bg-transparent text-gray-500' : 'bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700/30 text-gray-800 dark:text-gray-300 focus:ring-1 focus:ring-indigo-500/50'}`}
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
                          <label className="block text-sm font-semibold text-indigo-600 dark:text-indigo-300">3. 多角色管理 (V4.5 Characters)</label>
                          {isOwner && (
                              <button onClick={addCharacter} className="text-xs flex items-center bg-white dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm text-indigo-600 dark:text-indigo-200">
                                  + 添加角色
                              </button>
                          )}
                      </div>
                      
                      <div className="space-y-3">
                          {(params.characters || []).length === 0 && (
                              <div className="text-xs text-gray-400 text-center py-2">暂无角色定义，Prompt 将作为整体处理。</div>
                          )}
                          {(params.characters || []).map((char, idx) => (
                              <div key={char.id} className="bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
                                  <div className="flex gap-3 items-start">
                                      <div className="flex-1">
                                          <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Prompt</label>
                                          <textarea 
                                              disabled={!isOwner}
                                              value={char.prompt}
                                              onChange={(e) => updateCharacter(idx, { prompt: e.target.value })}
                                              className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-16 resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                              placeholder="e.g. 1girl, blue hair, standing"
                                          />
                                      </div>
                                      <div className="w-24 flex flex-col gap-2">
                                          <div>
                                              <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Center X</label>
                                              <input 
                                                  type="number" step="0.1" min="0" max="1"
                                                  disabled={!isOwner}
                                                  value={char.x}
                                                  onChange={(e) => updateCharacter(idx, { x: parseFloat(e.target.value) })}
                                                  className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                              />
                                          </div>
                                          <div>
                                              <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Center Y</label>
                                              <input 
                                                  type="number" step="0.1" min="0" max="1"
                                                  disabled={!isOwner}
                                                  value={char.y}
                                                  onChange={(e) => updateCharacter(idx, { y: parseFloat(e.target.value) })}
                                                  className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                              />
                                          </div>
                                      </div>
                                      {isOwner && (
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
                  <section>
                    <label className="block text-sm font-semibold text-red-500 dark:text-red-400 mb-2">负面 Prompt</label>
                    <textarea
                      disabled={!isOwner}
                      className={`w-full border rounded-lg p-3 outline-none font-mono text-sm leading-relaxed min-h-[80px] ${!isOwner ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-red-900 dark:text-red-100/80 focus:ring-1 focus:ring-red-500/50'}`}
                      value={negativePrompt}
                      onChange={(e) => {setNegativePrompt(e.target.value); setHasChanges(true)}}
                    />
                  </section>

                  {/* Params */}
                  <section className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                     <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">参数设置</h3>
                     
                     {/* V4.5 Quality & Preset */}
                     <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                         <div className="flex items-center gap-2">
                             <input 
                                type="checkbox" 
                                id="qualityToggle"
                                disabled={!isOwner}
                                checked={params.qualityToggle ?? true}
                                onChange={(e) => {
                                    setParams({ ...params, qualityToggle: e.target.checked });
                                    if(isOwner) setHasChanges(true);
                                }}
                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                             />
                             <label htmlFor="qualityToggle" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                                 Quality Tags (Auto)
                             </label>
                         </div>
                         <div>
                             <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">负面预设 (UC Preset)</label>
                             <select 
                                disabled={!isOwner}
                                className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm"
                                value={params.ucPreset ?? 0}
                                onChange={(e) => {
                                    setParams({ ...params, ucPreset: parseInt(e.target.value) });
                                    if(isOwner) setHasChanges(true);
                                }}
                             >
                                 <option value={0}>Heavy (Default)</option>
                                 <option value={1}>Light</option>
                                 <option value={2}>None</option>
                             </select>
                         </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                             <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">图片尺寸</label>
                             <select 
                                  disabled={!isOwner}
                                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm"
                                  value={getCurrentResolutionMode()}
                                  onChange={(e) => handleResolutionChange(e.target.value)}
                               >
                                  {Object.entries(RESOLUTIONS).map(([key, val]) => (
                                      <option key={key} value={key}>{val.label}</option>
                                  ))}
                               </select>
                         </div>
                         <div className="flex gap-2">
                             <div className="flex-1">
                                 <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">Steps (Max 28)</label>
                                 <input type="number" className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm" 
                                    value={params.steps} 
                                    max={28}
                                    onChange={(e) => {
                                        const val = Math.min(28, parseInt(e.target.value) || 0);
                                        setParams({...params, steps: val}); 
                                        if(isOwner) setHasChanges(true);
                                    }}
                                 />
                             </div>
                             <div className="flex-1">
                                 <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">Scale</label>
                                 <input type="number" className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm" 
                                    value={params.scale} 
                                    onChange={(e) => {setParams({...params, scale: parseFloat(e.target.value)}); if(isOwner) setHasChanges(true);}}
                                 />
                             </div>
                             {/* Seed Input */}
                             <div className="flex-1">
                                 <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">Seed (0随机)</label>
                                 <input 
                                    type="text" 
                                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm" 
                                    value={params.seed ?? 0} 
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setParams({...params, seed: isNaN(val) ? 0 : val}); 
                                        if(isOwner) setHasChanges(true);
                                    }}
                                 />
                             </div>
                         </div>
                     </div>
                  </section>
              </div>

              {/* Sticky Footer for Save Actions */}
              {isOwner && (
                <div className="fixed bottom-16 left-0 right-0 md:absolute md:bottom-0 p-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 flex justify-between items-center shadow-lg transform transition-transform duration-300 z-10">
                    <div className="text-xs text-gray-500 ml-2">
                        {hasChanges ? <span className="text-yellow-600 dark:text-yellow-500 font-medium">⚠️ 未保存</span> : <span className="text-green-600 dark:text-green-500">✅ 已保存</span>}
                    </div>
                    <button
                        onClick={handleSaveAll}
                        disabled={!hasChanges}
                        className={`px-6 py-1.5 rounded-md font-bold text-sm shadow-md transition-all transform active:scale-95 ${
                            hasChanges 
                            ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 text-white shadow-indigo-500/30' 
                            : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                        保存
                    </button>
                </div>
              )}
          </div>

          {/* Right Panel - Preview (Testing) - Order 1 on mobile (top) */}
          <div className="w-full lg:w-1/2 flex flex-col bg-gray-100 dark:bg-black/20 order-1 lg:order-2 border-b lg:border-b-0 border-gray-200 dark:border-gray-800 shrink-0">
              <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden min-h-[400px]">
                  {/* Subject / Variable Input */}
                  <div className="mb-4 bg-white dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-800">
                      <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-2">3. 主体 / 变量提示词 (Subject)</h3>
                      <p className="text-[10px] text-gray-400 mb-2">此处内容将作为整体描述插入，或作为 Base Caption 的补充。</p>
                      <textarea
                          className="w-full h-24 md:h-32 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-3 text-sm outline-none focus:border-indigo-500 font-mono resize-none"
                          placeholder="例如：1girl, solo, white dress, sitting..."
                          value={subjectPrompt}
                          onChange={(e) => {
                             setSubjectPrompt(e.target.value);
                             if (isOwner) setHasChanges(true); // Treat subject input as part of the saved chain now
                          }}
                      />
                  </div>

                  {/* Generated Image */}
                  <button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className={`w-full py-3 rounded-lg font-bold text-white shadow-lg transition-all mb-4 flex-shrink-0 ${
                          isGenerating ? 'bg-gray-400 cursor-wait' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500'
                      }`}
                      >
                      {isGenerating ? '生成中...' : '生成预览 (自动保存历史)'}
                  </button>
                  {errorMsg && <div className="text-red-500 text-xs mb-2 text-center">{errorMsg}</div>}
                  
                  <div 
                      className="flex-1 min-h-[300px] lg:min-h-0 bg-white dark:bg-gray-950/50 rounded-xl border border-gray-200 dark:border-gray-800 flex items-center justify-center relative group overflow-hidden cursor-zoom-in"
                      onClick={() => {
                        const img = generatedImage || chain.previewImage;
                        if(img) setLightboxImg(img);
                      }}
                   >
                      {generatedImage ? (
                          <>
                            <img src={generatedImage} alt="Generated" className="max-w-full max-h-full object-contain shadow-2xl" />
                            <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                <a href={generatedImage} download={getDownloadFilename()} className="bg-black/70 text-white px-3 py-1.5 rounded text-xs">下载</a>
                                {isOwner && <button onClick={(e) => { e.stopPropagation(); handleSavePreview(); }} disabled={isUploading} className="bg-indigo-600/90 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1">{isUploading ? '上传中...' : '设为封面'}</button>}
                            </div>
                          </>
                      ) : (
                          chain.previewImage ? (
                                <>
                                    <img src={chain.previewImage} alt="Cover" className="max-w-full max-h-full object-contain shadow-2xl opacity-50 grayscale hover:grayscale-0 transition-all duration-500" />
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <span className="bg-black/50 text-white px-3 py-1 rounded text-xs">当前封面</span>
                                    </div>
                                    <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                         <a href={chain.previewImage} download={getDownloadFilename()} className="bg-black/70 text-white px-3 py-1.5 rounded text-xs text-center cursor-pointer pointer-events-auto">下载封面</a>
                                    </div>
                                </>
                          ) : <div className="text-gray-400 text-xs">预览区</div>
                      )}
                      
                      {/* Manual Upload Cover Button */}
                      {isOwner && (
                         <div className="absolute bottom-4 right-4 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                             <input 
                                type="file" 
                                ref={fileInputRef}
                                className="hidden" 
                                accept="image/*" 
                                onChange={handleUploadCover}
                             />
                             <button 
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                                className="bg-gray-800/80 hover:bg-gray-700 text-white px-3 py-1.5 rounded text-xs shadow-lg backdrop-blur"
                             >
                                 {isUploading ? '上传中...' : '手动上传'}
                             </button>
                         </div>
                      )}
                  </div>
              </div>
          </div>
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
    </div>
  );
};
