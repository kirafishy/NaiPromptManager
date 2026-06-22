# ADR-0001: 历史压缩为 JPG 时不迁移 NAI 元数据

- **状态**: 已采纳
- **日期**: 2026-06-22
- **决策者**: 项目维护者

## 背景

本项目"历史"标签页的本地生图历史记录默认存储 NAI 服务端返回的原始 PNG（Base64 Data URI）。NAI V4.5 在 PNG 的 tEXt 块中写入完整的生成参数（含 `Comment` 字段，一大坨 JSON），第三方工具（NAI 官方页面拖入识别、NAI Image Viewer 等）依赖这个块来重建生成参数。

新增"历史压缩"功能后，PNG 会被 Canvas API（`toBlob('image/jpeg', quality)`）重编码为 JPG。Canvas 流水线**只搬运像素**，PNG tEXt 块**不会**迁移到 JPG。

## 决策

历史压缩为 JPG 时，**不**将 NAI 元数据迁移到 JPEG EXIF/XMP。下载已压缩的 JPG 时：

1. 文件扩展名根据 Data URI 前缀动态判断（`.png` / `.jpg`）
2. Lightbox 在用户下载 JPG 时显示提示，告知"下载后无法在外部工具中读取生成参数（但本应用内仍可查看）"
3. 不引入 piexifjs 等 EXIF 写入库

## 备选方案

### A. 使用 piexifjs 把 prompt+params 注入 JPEG EXIF UserComment / XMP

- 优点：跨工具兼容性更好（部分工具会读 EXIF UserComment）
- 缺点：
    - 引入额外前端依赖，违反项目"最少必要"基调（CLAUDE.md "依赖方向"原则）
    - 第三方 NAI 工具大多读 PNG tEXt 块，对 JPEG EXIF 的 NAI 协议支持参差
    - 自动 JPG 保存的所有新图都得走 EXIF 写入流程，增加生图后的延迟和失败面

### B. 额外提供"下载元数据 .txt"按钮

- 优点：零依赖
- 缺点：用户需双下载；外部工具仍不会识别这个 txt

### C. 完全不压缩 PNG，只压新生成的图（保留库存原 PNG 元数据）

- 优点：保留所有库存图的跨工具元数据
- 缺点：违反用户主诉求（"压缩当前历史图片节省空间"）

## 理由

- **应用内体验不受影响**：`LocalGenItem.prompt` 和 `LocalGenItem.params` 是独立字段，Lightbox 通过这两个字段读元数据，与图片像素流无关
- **诚实告知 > 偷偷损失**：Lightbox 提示文案让用户在下载前知情
- **依赖最小化**：与 CLAUDE.md 既定方针一致
- **可逆性弱但可接受**：用户对"已压缩图片在外部丢失元数据"是知情同意的（引导弹窗 + Lightbox 提示双重告知）

## 影响

- 已压缩的历史图片在外部工具中无法读取生成参数
- 用户压缩后无法回填 EXIF（PNG 原字节已被 JPG 覆盖）—— **单向门**
- 未来若有强烈跨工具需求，可：
    - 在"压缩"前提供"导出未压缩备份"选项
    - 重新评估方案 A（接受 piexifjs 依赖）

## 关联

- 术语定义：[CONTEXT.md](../../CONTEXT.md) — "历史压缩 / 自动 JPG 保存 / NAI 元数据"
- 实现入口：`components/GenHistory.tsx` Lightbox 区域、`services/imageCompression.ts`
