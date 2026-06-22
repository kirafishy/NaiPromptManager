/**
 * 图片压缩工具模块（纯函数 + Canvas API）
 *
 * 职责：把 PNG Data URI 重编码为 JPG Data URI，仅搬运像素。
 *
 * **重要**：Canvas 流水线不会迁移 PNG tEXt 块；压缩后的 JPG 在外部工具中
 * 无法读取 NAI 元数据。本应用内的元数据来自 LocalGenItem.prompt / params
 * 独立字段，不受影响。详见 docs/adr/0001-jpg-compaction-discards-nai-metadata.md。
 *
 * 设计选择：本模块只提供"PNG → JPG 一次性转码"能力，不持有 IndexedDB
 * 依赖，不感知 UI。调用方（GenHistory / ChainEditor）负责存储与编排。
 */

/** 单次压缩的结果 */
export interface CompressionResult {
    /** JPG 编码后的 Data URI，形如 `data:image/jpeg;base64,...` */
    jpgDataUri: string;
    /** 原始 PNG 的近似字节数（按 base64 长度反推） */
    originalBytes: number;
    /** 压缩后 JPG 的真实字节数（来自 Blob.size） */
    compressedBytes: number;
}

/**
 * 判断 Data URI 是否已经是 JPG 编码。
 *
 * 用于压缩主循环和 UI 的幂等判断：已是 JPG 的项跳过压缩。
 */
export function isJpgDataUri(dataUri: string): boolean {
    return dataUri.startsWith('data:image/jpeg') || dataUri.startsWith('data:image/jpg');
}

/**
 * 从 base64 Data URI 估算原始字节数。
 *
 * base64 每 4 个字符表示 3 字节原始数据，末尾 `=` 是 padding。
 * 此函数用于"节省空间"统计的 PNG 侧数据；JPG 侧直接用 Blob.size 即可。
 *
 * 注意：传入非 Data URI 会返回 0，避免抛错破坏批量循环。
 */
export function estimateBytesFromDataUri(dataUri: string): number {
    const commaIdx = dataUri.indexOf(',');
    if (commaIdx < 0) return 0;
    const base64 = dataUri.slice(commaIdx + 1);
    const len = base64.length;
    if (len === 0) return 0;
    // 计算 padding 数量（最多 2 个 '='）
    let padding = 0;
    if (base64.endsWith('==')) padding = 2;
    else if (base64.endsWith('=')) padding = 1;
    return Math.floor(len * 3 / 4) - padding;
}

/**
 * 把 PNG Data URI 压缩为 JPG Data URI。
 *
 * 流水线：Image 解码 → Canvas 重绘 → toBlob('image/jpeg', quality) → FileReader 读为 Data URI。
 *
 * @param pngDataUri 输入 Data URI（理论上 PNG，但 Image 元素也吃 JPG/WebP，调用方保证语义即可）
 * @param quality   JPG 质量 [0.01, 1.00]，对齐 HTML5 canvas.toBlob 的 quality 参数
 * @returns         压缩后 Data URI + 原始/压缩字节数
 * @throws          Image 加载失败、Canvas 上下文获取失败、toBlob 返回 null 时抛错
 */
export async function compressPngToJpg(
    pngDataUri: string,
    quality: number
): Promise<CompressionResult> {
    // 1) 解码为 HTMLImageElement
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('图片解码失败'));
        el.src = pngDataUri;
    });

    // 2) Canvas 重绘
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('无法获取 Canvas 2D 上下文');
    }
    ctx.drawImage(img, 0, 0);

    // 3) 编码为 JPG Blob
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            b => b ? resolve(b) : reject(new Error('Canvas.toBlob 返回空，编码失败')),
            'image/jpeg',
            quality
        );
    });

    // 4) Blob → Data URI
    const jpgDataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('FileReader 读取失败'));
        reader.readAsDataURL(blob);
    });

    return {
        jpgDataUri,
        originalBytes: estimateBytesFromDataUri(pngDataUri),
        compressedBytes: blob.size,
    };
}
