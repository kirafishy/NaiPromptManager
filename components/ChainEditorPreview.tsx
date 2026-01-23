
import React, { useRef } from 'react';

interface ChainEditorPreviewProps {
    subjectPrompt: string;
    setSubjectPrompt: (s: string) => void;
    isGenerating: boolean;
    handleGenerate: () => void;
    errorMsg: string | null;
    generatedImage: string | null;
    previewImage: string | undefined;
    setLightboxImg: (img: string | null) => void;
    isOwner: boolean;
    isUploading: boolean;
    handleSavePreview: () => void;
    handleUploadCover: (e: React.ChangeEvent<HTMLInputElement>) => void;
    getDownloadFilename: () => string;
}

export const ChainEditorPreview: React.FC<ChainEditorPreviewProps> = ({
    subjectPrompt,
    setSubjectPrompt,
    isGenerating,
    handleGenerate,
    errorMsg,
    generatedImage,
    previewImage,
    setLightboxImg,
    isOwner,
    isUploading,
    handleSavePreview,
    handleUploadCover,
    getDownloadFilename
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
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
                        onChange={(e) => setSubjectPrompt(e.target.value)}
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
                        const img = generatedImage || previewImage;
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
                        previewImage ? (
                                <>
                                    <img src={previewImage} alt="Cover" className="max-w-full max-h-full object-contain shadow-2xl opacity-50 grayscale hover:grayscale-0 transition-all duration-500" />
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <span className="bg-black/50 text-white px-3 py-1 rounded text-xs">当前封面</span>
                                    </div>
                                    <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                        <a href={previewImage} download={getDownloadFilename()} className="bg-black/70 text-white px-3 py-1.5 rounded text-xs text-center cursor-pointer pointer-events-auto">下载封面</a>
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
    );
};
