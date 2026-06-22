# PROGRESS — NAI Prompt Manager

> 全局历史记录文件，按 CLAUDE.md 3.2 维护。每个 session 完成后追加。
> 短期交接快照在 [HANDOFF.md](./HANDOFF.md)，本文件为长期累积。

---

## 2026-06-22 — 图片 JPG 压缩功能落地

### 完成内容

- **新建** `services/imageCompression.ts` — 纯函数 + Canvas API，提供 `compressPngToJpg` / `isJpgDataUri` / `estimateBytesFromDataUri` 三个导出
- **扩展** `services/localHistory.ts` — 新增 `updateImage(id, newImageUrl)` 方法（单条 readwrite 事务，仅替换 imageUrl 字段，其余保持）
- **改造** `components/ArtistAdmin.tsx` —
  - 子标签顺序：`'profile'` 挪到最左
  - 默认 `activeTab` 改为 `'profile'`（所有角色统一）
  - "个人设置" 文案 → "偏好设置"
  - 新增"图片压缩"小节：自动 JPG 保存 toggle + JPG 质量滑块，绑定 `naipm.compaction.*` LocalStorage
- **改造** `components/ChainEditor.tsx` — `handleGenerate` 在 `localHistory.add` 之前判断 `autoJpg`，开则压缩 PNG 为 JPG；失败回退 PNG 不阻塞主流程
- **改造** `components/Layout.tsx` — `'admin'` 项 label `'我的'` → `'设置'`，icon path 换成齿轮（双 path：齿轮 + 中心圆）
- **改造** `components/GenHistory.tsx`（最大块）—
  - header 增加桌面端独立"📦 压缩"按钮 + 清理菜单内"压缩 PNG..."项
  - 库无未压缩 PNG 时按钮 disabled，title 提示"无需压缩"
  - 批量压缩主循环：逐条独立事务、JPG 幂等跳过、单条失败计入 failed 不中止
  - 进度模态四元信息：已处理 / 节省空间 / 失败张数 / 预计剩余秒
  - 取消语义：立即停止后续，已压保留
  - 完成摘要：成功 / 失败 / 节省总量 / 压缩率%
  - Lightbox 单张压缩 UI：JPG 质量滑块 + 并排预览（debounce 400ms）+ 压缩按钮
  - Lightbox 已压缩态：显示"JPG"标签 + "下载后无法在外部工具读取生成参数"提示
  - `getDownloadFilename()` 根据 imageUrl 前缀动态选择 `.png` / `.jpg`
  - 单张压缩完成后 `setCacheState({}) + goToPage(currentPage, true)` 强制刷新
  - 引导弹窗：登录用户首次进入历史页弹一次，X / ESC / 遮罩 / "暂不启用" 都等于不启用 + 标记已展示
  - 主网格缩略图加 JPG 角标
- **更新** `README.md` — "我的 -> 个人设置" → "设置 -> 偏好设置"

### 关键架构决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | NAI 元数据迁移 | **不迁移到 JPEG EXIF**（[ADR-0001](./docs/adr/0001-jpg-compaction-discards-nai-metadata.md)） | 应用内 prompt/params 走独立字段，跨工具丢失通过 UI 提示告知 |
| 2 | IndexedDB schema | **不升级，DB_VERSION 保持 1** | imageUrl 字段天然容纳两种 MIME，前缀做幂等判断 |
| 3 | 工具模块位置 | `services/imageCompression.ts` | 纯函数 + 无 IndexedDB 依赖 + 无 UI 感知，调用方编排 |
| 4 | LocalStorage 命名空间 | `naipm.compaction.*` | 与其他 LocalStorage 项隔离，便于未来扩展 |
| 5 | autoJpg 默认值 | `false` | 不影响老用户既有行为；通过引导弹窗主动告知 |
| 6 | autoJpg 失败回退 | **降级为 PNG 入库不阻塞** | 元数据在独立字段里，PNG 不丢功能；批量循环也是单条 fail-skip |
| 7 | 批量压缩原子性 | **逐条独立事务** | 单条失败不影响其他；用户取消可立即生效 |
| 8 | 预览响应模型 | **软实时，debounce 400ms** | 性能优先于即时反馈 |

### 验证

- ✅ `tsc -b` 无错误（含每文件局部 `npx tsc --noEmit` 增量检查）
- ✅ `vite build` 成功（54 modules，dist 521KB gzip 149KB）
- ✅ `esbuild worker/index.ts` 成功（90.6KB）
- ⏳ 手动 `npm run dev:local` 验证留给下一个 session 开始时执行（DoD 清单见 HANDOFF.md）

### 未触碰的"不动"项

- `services/localHistory.ts` 既有方法（`add` / `getAll` / `delete` / `clear` / `getPage` 等）保持原样，仅新增 `updateImage`
- `types.ts` 的 `LocalGenItem`（`imageUrl: string` 兼容两种 MIME）
- IndexedDB schema、`DB_VERSION = 1`
- Worker 后端、灵感图库 / R2 存储
- `ArtistAdmin.tsx` tab id `'admin'` / `'profile'` 字符串不变（仅 UI 文案与顺序变化）

---

## 2026-06-22 (续) — Lightbox 并排预览可读性修复

### 用户反馈

1. Lightbox 并排预览图太小完全看不出压缩效果
2. 引导弹窗没提示用户可以在详情里看压缩效果

### 修复内容

- **`components/GenHistory.tsx`** —
  - 并排预览容器从 `flex items-center justify-center` + `max-w-full max-h-[85%]` 改为 **100% 原尺寸 + 双列 overflow-auto 同步滚动**
  - 新增 `previewLeftRef` / `previewRightRef` 两个 ref + `scrollSyncingRef` 防回弹标记
  - 新增 useEffect 监听双方 scroll 事件，互相镜像 scrollTop/scrollLeft
  - 列顶部 sticky 标签条，滚动时不丢方向感
  - 左下角 toast 提示用户"拖动查看贴边/眼睛/纹理细节"
  - 引导弹窗主文案后插入琥珀色提示块："想先看效果？点开任意历史图详情，拖动 JPG 质量滑块就能实时预览"

### 设计选择

| 选项 | 选择 | 理由 |
|---|---|---|
| 预览交互 | **双列同步滚动** | 保留"一眼看全貌"不变性；缩放交给浏览器滚动 |
| 防回弹机制 | **ref 标记** 而非 RAF / debounce | 单帧最简洁、零延迟、无内存累积 |
| 标签位置 | **sticky 顶部** 而非外置 | 滚动时仍能看到当前对比侧 |

### 验证

- ✅ `tsc -b` 无错误
- ✅ `vite build` 通过（bundle +1.3KB）
- ✅ `esbuild build:worker` 通过
- ✅ 手动 `npm run dev:local` 已由用户完成验证并确认通过（含 Lightbox 预览、引导弹窗、设置路径、自动 JPG 保存、游客不弹引导等主流程）

---

## 2026-06-22 (续) — Tailwind Preflight 覆盖与验证完成

### 用户反馈

- Lightbox 对比图仍然不是 100% 原尺寸，而是在窗口内自适应显示全图。

### 根因

Tailwind Preflight 全局注入：

```css
img,
video {
  max-width: 100%;
  height: auto;
}
```

此前并排预览里的 `<img className="block shadow-lg" />` 虽然移除了 `max-h` / `object-contain`，但仍被全局 `max-width: 100%` 限制，导致实际显示仍适应父容器宽度。

### 修复

- 在并排预览的 PNG / JPG 两张图上加 `max-w-none h-auto`：
  - 覆盖 Preflight 的 `max-width: 100%`
  - 保持等比高度
  - 只影响压缩对比预览，不影响缩略图、普通 Lightbox 单图或其他页面图片

### 验证与发布

- ✅ `tsc -b` 通过
- ✅ `vite build` 通过
- ✅ `esbuild build:worker` 通过
- ✅ 用户完成 `npm run dev:local` 手动验证，确认全部 DoD 通过
- ✅ 用户确认已推送到远端

### 关联提交

- `51fc1bf` — `feat(history): 添加图片 JPG 压缩与自动 JPG 保存`
- `676be68` — `fix(history): Lightbox 并排预览改 100% 原尺寸双列同步滚动 + 引导弹窗加查看效果提示`
- `447047a` — `docs: 更新 PROGRESS / HANDOFF，记录 Lightbox 预览可读性修复`
- `58f3ac1` — `fix(history): 覆盖 Tailwind Preflight 让对比图按原始尺寸显示`

---

## 2026-06-22 (续) — 军火库权重语法偏好

### 完成内容

- **改造** `components/ArtistAdmin.tsx` — 在“设置 → 偏好设置”新增“军火库”卡片，可切换画师 tag 复制权重语法
  - 新增 LocalStorage key：`naipm.artistLibrary.weightSyntax`
  - 默认值：`numeric`
  - 可选值：`numeric` / `bracket`
  - 切换时派发 `naipm-artist-weight-syntax-change` 事件，让当前 SPA 内军火库同步刷新偏好
- **改造** `components/ArtistLibrary.tsx` — 军火库购物车内部权重统一为 step count
  - step 范围：`-10..10`
  - 数字语法步长：`0.1`
  - 数字输出示例：`1.3::artist:name::` / `0.8::artist:name::`
  - 括号输出示例：`{{artist:name}}` / `[[artist:name]]`
  - 导入逻辑新增数字语法解析：`1.3::artist:name::` → step `3`
  - 现有 `{}` / `[]` 导入保持兼容，并统一剥离括号内外的 `artist:` 前缀后 clamp 到 `-10..10`
- **改造** `components/ArtistLibraryCart.tsx` — 底部购物车显示当前权重模式提示：`数字权重 ±0.1` 或 `括号权重 ±1层`
- **新增** `docs/aegis/` workspace 与 implementation plan，记录本次设计、基线和执行计划

### 关键设计决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 默认语法 | **数字权重** | 符合 NovelAI V4+ 更精确写法 |
| 2 | 内部表示 | **step count** | 保持 +/- UI 简单，同时支持数字和括号两种投影 |
| 3 | 权重范围 | **-10..10** | 对应数字 `0.0..2.0`，覆盖更宽的手动调权范围 |
| 4 | 存储位置 | **LocalStorage** | 纯个人偏好，不需要云端同步 |
| 5 | 导入闭环 | **支持数字语法导入** | 复制出去的内容可以重新导入，不形成半截功能 |

### 验证

- ✅ `npm run build` 通过（tsc + vite + worker esbuild）
- ✅ 手动 `npm run dev:local` 已由用户完成验证并确认通过（默认数字、切换括号、数字语法导入闭环）
