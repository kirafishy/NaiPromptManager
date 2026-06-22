# 项目领域术语表（CONTEXT.md）

本文档是项目的**领域语言词典**，不是规范文档，也不是实现说明。
当与代码或其他文档冲突时，以本文档定义的术语含义为准。

---

## 历史压缩相关术语

### 历史压缩（History Compaction）
对**一条或多条** `LocalGenItem` 执行的 PNG→JPG 重编码操作：将 `imageUrl` 中当前为 PNG 的 base64 Data URI 解码、用 Canvas 重绘后以 JPG 重新编码，就地覆盖原字段。

- **作用范围**：过去（已存在的历史记录）
- **触发方式**：
  - **批量历史压缩**：用户在"历史"标签页 header 点击"压缩"按钮，扫描整库未压缩的 PNG 项
  - **单张历史压缩**：用户在 Lightbox 中对当前查看的图片单独触发
- **不影响**：未来新生成的图片（那是"自动 JPG 保存"的职责）
- **幂等性**：`imageUrl` 已是 `data:image/jpeg` 的项自动跳过，重复操作无副作用

### 自动 JPG 保存（Auto-JPG Save）
持续生效的用户偏好开关。打开后，`ChainEditor.handleGenerate` 在把 NAI 返回的 PNG 写入 IndexedDB 之前，先将其转码为 JPG。

- **作用范围**：未来（新生成的图片）
- **触发方式**：用户在设置面板（具体位置待定）切换开关
- **不影响**：已存在的历史记录

### JPG 质量（JPG Quality）
0.01 – 1.00 的浮点数，对应 HTML5 `canvas.toBlob(callback, 'image/jpeg', quality)` 的 `quality` 参数。

- **唯一性**：项目中只有一个 JPG 质量配置，由"历史压缩"和"自动 JPG 保存"**共享**
- **存储位置**：LocalStorage（待与"暗色模式偏好"等同等级别）
- **默认值**：0.85

### 压缩引导（Compaction Onboarding）
新用户首次进入"历史"标签页时展示的一次性引导弹窗，告知"自动 JPG 保存"功能的存在。

- **范围**：仅登录用户（admin / vip / user）；游客不弹
- **持久化**：LocalStorage `naipm.compaction.onboarded = true` 标记已展示过，不再弹
- **关闭语义**：X / ESC / 点遮罩 / "暂不启用" 全部等价 = 不启用 + 标记已展示

---

## LocalStorage Key 命名约定

本项目所有压缩相关的 LocalStorage 键统一使用 `naipm.compaction.*` 命名空间：

| Key | 类型 | 默认 | 含义 |
|---|---|---|---|
| `naipm.compaction.autoJpg` | `'true' \| 'false'` | `'false'` | 自动 JPG 保存开关 |
| `naipm.compaction.quality` | `string`（0.01-1.00） | `'0.85'` | JPG 质量 |
| `naipm.compaction.onboarded` | `'true'` | 未设置 | 压缩引导已展示过的标记 |

（命名空间前缀 `naipm.` = NAI Prompt Manager 缩写，便于未来与其他 LocalStorage 项区分。）

### 压缩预览（Compaction Preview）
单张历史压缩前，在 Lightbox 中以**左右并排**方式展示原图（PNG）和当前 JPG 质量下的压缩结果。

- **响应模型**：**软实时** —— 用户调整 JPG 质量滑块后，停止操作满 debounce 时长才重绘预览（性能优先于即时反馈）
- **范围**：仅在 Lightbox 中可见；批量历史压缩不提供逐项预览

### 偏好设置（Preferences）
"设置"标签页（原名"我的"）下的子标签页之一，容纳所有用户级偏好项：

- 密码修改
- 暗色模式开关
- **JPG 质量** 滑块（"历史压缩"与"自动 JPG 保存"共享）
- **自动 JPG 保存** 开关

历史命名："偏好设置"由原"个人设置"重命名而来。组件文件 `ArtistAdmin.tsx` 中的 tab id 仍保留 `'profile'`，仅 UI 文案变化。

## 已存在的相关术语（沿用）

### LocalGenItem
本地生图历史的单条记录，存储于 IndexedDB（DB: `NAI_History_DB`, store: `generations`）。
`imageUrl` 字段是 base64 Data URI（当前实际为 `data:image/png;base64,...`，历史压缩后可能为 `data:image/jpeg;base64,...`）。

### NAI 元数据
NAI V4.5 在原始 PNG tEXt 块中写入的生成参数。
**重要事实**：本项目的 `LocalGenItem` 已将 `prompt` 和 `params` **显式存为独立字段**，不依赖 PNG tEXt 块，因此历史压缩为 JPG **不会丢失** NAI 生成参数信息（在本应用内）。

**跨工具限制**：见 [ADR-0001](docs/adr/0001-jpg-compaction-discards-nai-metadata.md) —— 压缩后的 JPG 在外部工具中无法读取 NAI 元数据。
