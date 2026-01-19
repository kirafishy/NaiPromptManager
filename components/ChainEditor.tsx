
import React, { useState, useEffect, useMemo } from 'react';
import { ChainWithVersion, PromptVersion, PromptChain, PromptModule } from '../types';
// Updated import
import { extractVariables, compilePrompt } from '../services/promptUtils';
import { generateImage } from '../services/naiService';

interface ChainEditorProps {
  chain: ChainWithVersion;
  onSaveVersion: (data: Partial<PromptVersion>) => void;
  onUpdateChain: (id: string, updates: Partial<PromptChain>) => void;
  onBack: () => void;
}

const RESOLUTIONS = {
  Portrait: { width: 832, height: 1216, label: "竖屏 (832x1216)" },
  Landscape: { width: 1216, height: 832, label: "横屏 (1216x832)" },
  Square: { width: 1024, height: 1024, label: "方形 (1024x1024)" },
};

export const ChainEditor: React.FC<ChainEditorProps> = ({ chain, onSaveVersion, onUpdateChain, onBack }) => {
  // --- Chain Info State ---
  const [chainName, setChainName] = useState(chain.name);
  const [chainDesc, setChainDesc] = useState(chain.description);
  const [isEditingInfo, setIsEditingInfo] = useState(false);

  // --- Version/Prompt State ---
  const [formData, setFormData] = useState<Partial<PromptVersion>>({
    basePrompt: '',
    negativePrompt: '',
    modules: [],
    params: undefined
  });
  const [hasChanges, setHasChanges] = useState(false);

  // --- Testing State ---
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [activeModules, setActiveModules] = useState<Record<string, boolean>>({});
  const [finalPrompt, setFinalPrompt] = useState('');
  
  // --- Generation State ---
  // API Key is now handled by the backend worker
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // --- Initialization ---
  useEffect(() => {
    if (chain.latestVersion) {
      setFormData({
        basePrompt: chain.latestVersion.basePrompt,
        negativePrompt: chain.latestVersion.negativePrompt,
        modules: chain.latestVersion.modules,
        params: chain.latestVersion.params
      });
      // Initialize module toggles
      const initialModules: Record<string, boolean> = {};
      if (chain.latestVersion.modules) {
        chain.latestVersion.modules.forEach(m => {
          initialModules[m.id] = m.isActive;
        });
      }
      setActiveModules(initialModules);
    }
    setChainName(chain.name);
    setChainDesc(chain.description);
  }, [chain]);

  // --- Logic: Variables & Compilation ---
  const requiredVars = useMemo(() => {
    // Combine base prompt and ACTIVE modules content
    let textToScan = (formData.basePrompt || '') + ' ';
    (formData.modules || []).forEach(m => {
      if (activeModules[m.id] ?? true) { 
        textToScan += m.content + ' ';
      }
    });
    return extractVariables(textToScan);
  }, [formData.basePrompt, formData.modules, activeModules]);

  useEffect(() => {
    // Compile in real-time
    const tempVersion = {
        ...formData,
        modules: (formData.modules || []).map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }))
    } as PromptVersion; 

    const compiled = compilePrompt(tempVersion, variables);
    setFinalPrompt(compiled);
  }, [formData, variables, activeModules]);


  // --- Handlers: Prompt Editing ---
  const handleInputChange = (field: keyof PromptVersion, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleModuleChange = (index: number, key: keyof PromptModule, value: string) => {
    const newModules = [...(formData.modules || [])];
    newModules[index] = { ...newModules[index], [key]: value };
    handleInputChange('modules', newModules);
  };

  const addModule = () => {
    const newModule: PromptModule = {
      id: crypto.randomUUID(),
      name: '新模块',
      content: '',
      isActive: true
    };
    handleInputChange('modules', [...(formData.modules || []), newModule]);
  };

  const removeModule = (index: number) => {
    const newModules = [...(formData.modules || [])];
    newModules.splice(index, 1);
    handleInputChange('modules', newModules);
  };

  // --- Handlers: Testing & Generation ---
  const toggleModuleActive = (id: string) => {
    setActiveModules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleResolutionChange = (mode: string) => {
    if (mode === 'Custom') return;
    const res = RESOLUTIONS[mode as keyof typeof RESOLUTIONS];
    handleInputChange('params', { ...formData.params, width: res.width, height: res.height });
  };

  const getCurrentResolutionMode = () => {
    const w = formData.params?.width;
    const h = formData.params?.height;
    if (w === 832 && h === 1216) return 'Portrait';
    if (w === 1216 && h === 832) return 'Landscape';
    if (w === 1024 && h === 1024) return 'Square';
    return 'Custom';
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    try {
        // Pass empty string for key, worker handles it
        const img = await generateImage('', finalPrompt, formData.negativePrompt || '', formData.params as any);
        setGeneratedImage(img);
    } catch (e: any) {
        setErrorMsg(e.message);
    } finally {
        setIsGenerating(false);
    }
  };

  const handleSavePreview = async () => {
    if (!generatedImage) return;
    if(confirm('将当前生成的图片设为该 Chain 的封面图？')) {
        onUpdateChain(chain.id, { previewImage: generatedImage });
        alert('封面已更新');
    }
  };

  const handleSaveInfo = () => {
    onUpdateChain(chain.id, { name: chainName, description: chainDesc });
    setIsEditingInfo(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Top Bar: Chain Info & Navigation */}
      <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          
          {isEditingInfo ? (
              <div className="flex items-center gap-2 flex-1 max-w-2xl">
                  <input type="text" value={chainName} onChange={e => setChainName(e.target.value)} className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-900 dark:text-white text-sm focus:border-indigo-500 outline-none font-bold" />
                  <input type="text" value={chainDesc} onChange={e => setChainDesc(e.target.value)} className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-300 text-sm flex-1 focus:border-indigo-500 outline-none" />
                  <button onClick={handleSaveInfo} className="text-green-500 hover:text-green-600 dark:hover:text-green-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
              </div>
          ) : (
             <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingInfo(true)}>
                <h1 className="text-lg font-bold text-gray-900 dark:text-white">{chain.name}</h1>
                <span className="text-gray-500 dark:text-gray-500 text-sm hidden md:inline truncate max-w-xs">{chain.description}</span>
                <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:text-gray-600 dark:group-hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                <span className="ml-2 text-xs bg-gray-200 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-600 dark:text-gray-400">v{chain.latestVersion?.version}</span>
             </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
            {/* API Key Input Removed */}
            {hasChanges && <span className="text-yellow-600 dark:text-yellow-500 text-xs animate-pulse">未保存</span>}
            <button
                onClick={() => { onSaveVersion(formData); setHasChanges(false); }}
                disabled={!hasChanges}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-all ${
                hasChanges 
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }`}
            >
                保存版本
            </button>
        </div>
      </header>

      {/* Main Split Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          
          {/* Left: Editor */}
          <div className="w-full lg:w-1/2 flex flex-col border-r border-gray-200 dark:border-gray-800 overflow-y-auto bg-white dark:bg-gray-900">
              <div className="p-6 space-y-6 max-w-3xl mx-auto w-full">
                  
                  {/* Base Prompt */}
                  <section>
                    <div className="flex justify-between items-end mb-2">
                        <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">基础 Prompt (Base)</label>
                        <span className="text-xs text-gray-500">使用 <code className="text-yellow-600 dark:text-yellow-500">{`{变量名}`}</code> 作为占位符</span>
                    </div>
                    <textarea
                      className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-3 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm leading-relaxed min-h-[100px]"
                      value={formData.basePrompt}
                      onChange={(e) => handleInputChange('basePrompt', e.target.value)}
                      placeholder="masterpiece, best quality..."
                    />
                  </section>

                   {/* Modules */}
                  <section>
                    <div className="flex justify-between items-center mb-3">
                        <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">模块 (Modules)</label>
                        <button onClick={addModule} className="text-xs flex items-center text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded transition-colors">
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                            添加
                        </button>
                    </div>
                    <div className="space-y-3">
                        {(formData.modules || []).map((mod, idx) => (
                            <div key={mod.id} className={`bg-gray-50 dark:bg-gray-800/40 border rounded-lg p-3 transition-colors ${activeModules[mod.id] !== false ? 'border-gray-300 dark:border-gray-700' : 'border-gray-200 dark:border-gray-800 opacity-60'}`}>
                                <div className="flex gap-2 mb-2 items-center">
                                    <input type="checkbox" checked={activeModules[mod.id] !== false} onChange={() => toggleModuleActive(mod.id)} className="rounded bg-gray-100 dark:bg-gray-900 border-gray-400 dark:border-gray-600 text-indigo-600 focus:ring-0" />
                                    <input 
                                        type="text"
                                        className="bg-transparent border-b border-transparent hover:border-gray-400 dark:hover:border-gray-600 focus:border-indigo-500 text-indigo-600 dark:text-indigo-300 font-medium text-sm outline-none px-1 w-1/3"
                                        value={mod.name}
                                        onChange={(e) => handleModuleChange(idx, 'name', e.target.value)}
                                        placeholder="模块名称"
                                    />
                                    <div className="flex-1"></div>
                                    <button onClick={() => removeModule(idx)} className="text-gray-400 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                                <textarea
                                    className="w-full bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700/30 rounded p-2 text-gray-800 dark:text-gray-300 focus:ring-1 focus:ring-indigo-500/50 outline-none font-mono text-xs h-16 resize-none"
                                    value={mod.content}
                                    onChange={(e) => handleModuleChange(idx, 'content', e.target.value)}
                                    placeholder="模块 Prompt 内容..."
                                />
                            </div>
                        ))}
                    </div>
                  </section>

                  {/* Negative Prompt */}
                  <section>
                    <label className="block text-sm font-semibold text-red-500 dark:text-red-400 mb-2">负面 Prompt (Negative)</label>
                    <textarea
                      className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-3 text-red-900 dark:text-red-100/80 focus:ring-1 focus:ring-red-500/50 outline-none font-mono text-sm leading-relaxed min-h-[80px]"
                      value={formData.negativePrompt}
                      onChange={(e) => handleInputChange('negativePrompt', e.target.value)}
                    />
                  </section>

                  {/* Params */}
                  <section className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                     <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">参数设置</h3>
                     <div className="grid grid-cols-2 gap-4">
                         <div>
                             <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">图片尺寸</label>
                             <select 
                                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 outline-none"
                                  value={getCurrentResolutionMode()}
                                  onChange={(e) => handleResolutionChange(e.target.value)}
                               >
                                  {Object.entries(RESOLUTIONS).map(([key, val]) => (
                                      <option key={key} value={key}>{val.label}</option>
                                  ))}
                                  <option value="Custom" disabled>自定义 ({formData.params?.width}x{formData.params?.height})</option>
                               </select>
                         </div>
                         <div className="flex gap-2">
                             <div className="flex-1">
                                 <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">Steps (步数)</label>
                                 <input type="number" className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 outline-none" 
                                    value={formData.params?.steps || 28} 
                                    onChange={(e) => handleInputChange('params', {...formData.params, steps: parseInt(e.target.value)})}
                                 />
                             </div>
                             <div className="flex-1">
                                 <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">Scale (CFG)</label>
                                 <input type="number" className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 outline-none" 
                                    value={formData.params?.scale || 5} 
                                    onChange={(e) => handleInputChange('params', {...formData.params, scale: parseFloat(e.target.value)})}
                                 />
                             </div>
                         </div>
                     </div>
                  </section>
              </div>
          </div>

          {/* Right: Testing & Preview */}
          <div className="w-full lg:w-1/2 flex flex-col bg-gray-100 dark:bg-black/20">
              <div className="flex-1 flex flex-col p-6 overflow-hidden">
                  
                  {/* Variables Inputs */}
                  <div className="mb-4 bg-white dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-800 max-h-48 overflow-y-auto">
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">变量填充</h3>
                      {requiredVars.length === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-gray-600 italic">未检测到变量 (使用 {'{abc}'} 格式)</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {requiredVars.map(v => (
                                <div key={v}>
                                    <label className="block text-xs font-medium text-indigo-600 dark:text-indigo-300 mb-1">{v}</label>
                                    <input
                                        type="text"
                                        className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-900 dark:text-white text-sm focus:border-indigo-500 outline-none"
                                        value={variables[v] || ''}
                                        onChange={(e) => setVariables(prev => ({ ...prev, [v]: e.target.value }))}
                                        placeholder={`输入 ${v}`}
                                    />
                                </div>
                            ))}
                        </div>
                      )}
                  </div>

                  {/* Final Prompt Preview */}
                  <div className="mb-4 relative group">
                      <div className="absolute -top-2 left-2 bg-gray-100 dark:bg-gray-900 px-1 text-xs text-gray-500">最终 Prompt</div>
                      <textarea 
                          readOnly 
                          value={finalPrompt} 
                          className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-800 rounded-lg p-3 text-xs text-gray-800 dark:text-gray-300 font-mono h-24 resize-none focus:outline-none"
                      />
                      <button 
                        onClick={() => {navigator.clipboard.writeText(finalPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000)}} 
                        className="absolute bottom-2 right-2 text-xs bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded border border-gray-300 dark:border-gray-700"
                      >
                          {copied ? '已复制' : '复制'}
                      </button>
                  </div>

                  {/* Generate Button */}
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className={`w-full py-3 rounded-lg font-bold text-white shadow-lg transition-all mb-4 ${
                        isGenerating 
                        ? 'bg-gray-400 dark:bg-gray-700 cursor-wait' 
                        : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-indigo-500/25'
                    }`}
                    >
                    {isGenerating ? '生成中 (NAI Diffusion V4.5)...' : '生成预览 (Generate)'}
                  </button>
                  {errorMsg && <div className="text-red-500 dark:text-red-400 text-xs mb-2 text-center bg-red-100 dark:bg-red-900/20 p-2 rounded">{errorMsg}</div>}

                  {/* Image Result */}
                  <div className="flex-1 min-h-0 bg-white dark:bg-gray-950/50 rounded-xl border border-gray-200 dark:border-gray-800 flex items-center justify-center relative group overflow-hidden">
                      {generatedImage ? (
                          <>
                            <img src={generatedImage} alt="Generated" className="max-w-full max-h-full object-contain shadow-2xl" />
                            <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <a 
                                    href={generatedImage} 
                                    download={`nai-${Date.now()}.png`} 
                                    className="bg-black/70 hover:bg-black text-white px-3 py-1.5 rounded text-xs backdrop-blur border border-white/10 flex items-center"
                                >
                                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    下载
                                </a>
                                <button 
                                    onClick={handleSavePreview} 
                                    className="bg-indigo-600/90 hover:bg-indigo-600 text-white px-3 py-1.5 rounded text-xs backdrop-blur border border-white/10 flex items-center shadow-lg"
                                >
                                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                    设为封面
                                </button>
                            </div>
                          </>
                      ) : (
                          <div className="text-gray-400 dark:text-gray-700 flex flex-col items-center">
                              <svg className="w-16 h-16 mb-2 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                              <span className="text-xs">预览图将显示在这里</span>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
};
