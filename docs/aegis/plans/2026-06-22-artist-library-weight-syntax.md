# 军火库权重语法偏好 implementation plan

## Goal

在“设置 → 偏好设置”新增“军火库权重语法”偏好，默认使用 NovelAI V4+ 数字权重语法。军火库购物车内部权重统一为 step count，范围 `-10..10`，数字模式每步 `0.1`，括号模式每步一层 `{}` / `[]`。导入同时支持现有括号语法和数字语法 `1.3::artist:name::`。

## Architecture

- 偏好 UI owner：`components/ArtistAdmin.tsx`
- 军火库格式化 / 导入解析 owner：`components/ArtistLibrary.tsx`
- 购物车按钮 UI owner：`components/ArtistLibraryCart.tsx`
- 不新增后端 API，不触碰 Worker / D1 / R2。
- 不把权重语法偏好写入云端；使用浏览器 LocalStorage。

## Tech Stack

- React 19 + TypeScript
- Vite / esbuild build pipeline
- LocalStorage for browser-local preferences

## Baseline/Authority Refs

- `CLAUDE.md`：项目架构、验证命令、偏好设置与本地存储模式。
- `HANDOFF.md` / `PROGRESS.md`：当前项目状态与前次 JPG 压缩偏好位置。
- 用户批准设计：方案 B；默认数字语法；范围 `-10..10`；导入支持数字语法。
- `docs/aegis/baseline/2026-06-22-initial-baseline.md`：初始双基线快照。

## Compatibility Boundary

- 保持 `nai_use_prefix` 现有行为。
- 保持 `nai_copy_history` 现有数据，不迁移、不重写。
- 只影响军火库复制与导入，不影响 `services/promptUtils.ts` 的全局 Prompt 编译。
- 已打开页面内购物车是内存态，允许按新 step 语义展示。
- 默认值为 `numeric`，首次使用直接输出数字权重。

## Verification

1. 运行 `npm run build`，期望 `tsc -b`、`vite build`、`build:worker` 全通过。
2. 手动运行页面后检查：
   - 偏好设置默认显示“数字权重”。
   - 军火库选择一个画师，点击 `+` 三次，复制得到 `1.3::artist:<name>::`。
   - 点击 `-` 到负权重，复制得到 `0.9::artist:<name>::` 或对应数值。
   - 切换到括号权重，复制得到 `{artist:<name>}` / `[artist:<name>]`。
   - 批量导入 `1.3::artist:<known>::` 后购物车显示对应权重。

## Architecture Integrity Lens

- Invariant：权重语法仅属于军火库复制/导入，不进入全局 prompt compiler。
- Canonical owner：`ArtistLibrary.tsx` 负责 `CartItem.weight` step 语义、格式化与导入解析。
- Responsibility overlap：`ArtistLibraryCart.tsx` 保持 dumb UI，不知道 NovelAI 数字/括号格式细节。
- Higher-level simplification：使用局部纯函数集中处理 clamp / format / parse。
- Retirement / falsifier：如果后续其他页面也需要权重语法，应抽出共享 helper；本次不提前抽。
- Verdict：edit-in-place，保持最小 owner 边界。

## Plan-Time Complexity Check

- Target files：`components/ArtistAdmin.tsx`、`components/ArtistLibrary.tsx`、`components/ArtistLibraryCart.tsx`
- Existing size / shape signals：`ArtistLibrary.tsx` 已超过 1000 行，新增逻辑必须集中在顶部纯函数和现有 handler，不散落 JSX。
- Owner fit：军火库权重逻辑仍属于 `ArtistLibrary.tsx`。
- Add-in-place risk：中等，主要风险是 format / parse 逻辑散乱。
- Better file boundary：本次不新增文件；用命名常量和局部纯函数降低熵。
- Recommendation：edit-in-place。

## Tasks

### Task 1 — 在军火库建立权重语法常量与纯函数

Files:
- Modify: `components/ArtistLibrary.tsx`

Why:
- 明确 `CartItem.weight` 是 step count，不再含糊地表示括号层数。

Impact/Compatibility:
- `weight = 0` 仍表示普通 tag。
- `weight > 0` 表示加强，`weight < 0` 表示减弱。
- 新范围 `-10..10` 覆盖数字 `0.0..2.0`。

Steps:
- [ ] Write test: 在本任务注释或临时手动 checklist 中确认输入输出：
  - step `0` + numeric → `artist:name`
  - step `3` + numeric → `1.3::artist:name::`
  - step `-2` + numeric → `0.8::artist:name::`
  - step `2` + bracket → `{{artist:name}}`
  - step `-1` + bracket → `[artist:name]`
- [ ] Verify RED: 当前 `formatTag` 只支持括号语法，无法满足数字输出；阅读 `components/ArtistLibrary.tsx:302` 和 `components/ArtistLibrary.tsx:311` 确认差异。
- [ ] Minimal code: 在 `ArtistLibrary.tsx` 顶部 `CartItem` 附近加入：

```ts
type ArtistWeightSyntax = 'numeric' | 'bracket';

const ARTIST_WEIGHT_SYNTAX_KEY = 'naipm.artistLibrary.weightSyntax';
const DEFAULT_ARTIST_WEIGHT_SYNTAX: ArtistWeightSyntax = 'numeric';
const ARTIST_WEIGHT_MIN_STEP = -5;
const ARTIST_WEIGHT_MAX_STEP = 5;
const ARTIST_WEIGHT_NUMERIC_STEP = 0.1;

const clampArtistWeightStep = (step: number) => {
    return Math.min(ARTIST_WEIGHT_MAX_STEP, Math.max(ARTIST_WEIGHT_MIN_STEP, step));
};

const getStoredArtistWeightSyntax = (): ArtistWeightSyntax => {
    const raw = localStorage.getItem(ARTIST_WEIGHT_SYNTAX_KEY);
    return raw === 'bracket' ? 'bracket' : DEFAULT_ARTIST_WEIGHT_SYNTAX;
};

const formatArtistTagWithWeight = (tag: string, step: number, syntax: ArtistWeightSyntax) => {
    const clampedStep = clampArtistWeightStep(step);
    if (clampedStep === 0) return tag;

    if (syntax === 'numeric') {
        const numericWeight = 1 + clampedStep * ARTIST_WEIGHT_NUMERIC_STEP;
        return `${numericWeight.toFixed(1)}::${tag}::`;
    }

    if (clampedStep > 0) return "{".repeat(clampedStep) + tag + "}".repeat(clampedStep);
    return "[".repeat(Math.abs(clampedStep)) + tag + "]".repeat(Math.abs(clampedStep));
};
```

- [ ] Verify GREEN: 暂不运行完整 build，TypeScript 应能解析新增类型；下一任务接线后统一 build。
- [ ] Commit: 不单独 commit；等待全部实现和验证通过后统一 commit。

### Task 2 — 接入军火库偏好读取、权重更新和复制格式化

Files:
- Modify: `components/ArtistLibrary.tsx`
- Modify: `components/ArtistLibraryCart.tsx`

Why:
- 让军火库实际使用用户偏好，并让 +/- 按 step count 工作。

Impact/Compatibility:
- `ArtistLibraryCart` 仍只调用 `updateWeight(index, delta)` 和 `formatTag(item)`。
- 可额外传入 `weightSyntax` 只用于 UI 提示，不让 cart 处理格式规则。

Steps:
- [ ] Write test: 手动检查清单：选择任意画师后，默认复制为数字语法；切换 LocalStorage 为 bracket 后刷新页面，复制为括号语法。
- [ ] Verify RED: 当前 `useState` 只有 `usePrefix`，没有 `artistWeightSyntax`；当前 `updateWeight` clamp 到 `-3..3`。
- [ ] Minimal code: 在 `ArtistLibrary` state 区加入：

```ts
const [artistWeightSyntax, setArtistWeightSyntax] = useState<ArtistWeightSyntax>(DEFAULT_ARTIST_WEIGHT_SYNTAX);
```

在已有 `useEffect` 的 LocalStorage 读取段加入：

```ts
setArtistWeightSyntax(getStoredArtistWeightSyntax());

const handleArtistWeightSyntaxStorage = (event: StorageEvent) => {
    if (event.key === ARTIST_WEIGHT_SYNTAX_KEY) {
        setArtistWeightSyntax(getStoredArtistWeightSyntax());
    }
};
window.addEventListener('storage', handleArtistWeightSyntaxStorage);
return () => window.removeEventListener('storage', handleArtistWeightSyntaxStorage);
```

若该 effect 已有 return，需要合并 cleanup，不要覆盖现有逻辑。

把 `updateWeight` 改为：

```ts
const updateWeight = (index: number, delta: number) => {
    const newCart = [...cart];
    newCart[index].weight = clampArtistWeightStep(newCart[index].weight + delta);
    setCart(newCart);
};
```

把 `formatTag` 改为：

```ts
const formatTag = (item: CartItem) => {
    const tag = (usePrefix ? 'artist:' : '') + item.name;
    return formatArtistTagWithWeight(tag, item.weight, artistWeightSyntax);
};
```

在 `ArtistLibraryCart` props 中可加入：

```ts
weightSyntax: 'numeric' | 'bracket';
```

并在底部已选数旁显示：

```tsx
<div className="text-xs text-gray-400 dark:text-gray-500">
    {weightSyntax === 'numeric' ? '数字权重 ±0.1' : '括号权重 ±1层'}
</div>
```

父组件调用：

```tsx
<ArtistLibraryCart
    cart={cart}
    setCart={setCart}
    updateWeight={updateWeight}
    toggleCart={toggleCart}
    copyCart={copyCart}
    formatTag={formatTag}
    weightSyntax={artistWeightSyntax}
/>
```

- [ ] Verify GREEN: 运行 `npm run build`。期望构建通过；如失败，修复 TypeScript props / cleanup 类型错误。
- [ ] Commit: 不单独 commit；等待全部实现和验证通过后统一 commit。

### Task 3 — 在偏好设置新增军火库权重语法切换

Files:
- Modify: `components/ArtistAdmin.tsx`

Why:
- 给用户一个明确入口选择数字权重或括号权重，默认数字语法。

Impact/Compatibility:
- 使用 LocalStorage，不依赖登录角色；所有角色进入偏好设置都可见。
- 不影响 JPG 压缩偏好。

Steps:
- [ ] Write test: 手动检查清单：首次打开偏好设置选中“数字权重”；点击“括号权重”后 LocalStorage key 为 `bracket`；点击“数字权重”后为 `numeric`。
- [ ] Verify RED: 当前 `ArtistAdmin.tsx` 偏好设置只有图片压缩和应用设置，没有军火库权重语法。
- [ ] Minimal code: 在 `ArtistAdmin.tsx` 顶部或 profile state 附近加入同名常量与 state：

```ts
type ArtistWeightSyntax = 'numeric' | 'bracket';
const ARTIST_WEIGHT_SYNTAX_KEY = 'naipm.artistLibrary.weightSyntax';

const [artistWeightSyntax, setArtistWeightSyntax] = useState<ArtistWeightSyntax>(() => {
    const raw = localStorage.getItem(ARTIST_WEIGHT_SYNTAX_KEY);
    return raw === 'bracket' ? 'bracket' : 'numeric';
});

const handleArtistWeightSyntaxChange = (syntax: ArtistWeightSyntax) => {
    setArtistWeightSyntax(syntax);
    localStorage.setItem(ARTIST_WEIGHT_SYNTAX_KEY, syntax);
};
```

在 profile tab 的图片压缩卡片后或应用设置前加入卡片：

```tsx
<div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-md">
    <h2 className="font-bold dark:text-white mb-1">军火库</h2>
    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        控制军火库底部已选画师复制时的 NovelAI 权重语法。默认使用 V4+ 数字权重。
    </p>
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 dark:bg-gray-900 p-1">
        <button
            type="button"
            onClick={() => handleArtistWeightSyntaxChange('numeric')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${artistWeightSyntax === 'numeric' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-300 shadow' : 'text-gray-500 dark:text-gray-400'}`}
        >
            数字权重
        </button>
        <button
            type="button"
            onClick={() => handleArtistWeightSyntaxChange('bracket')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${artistWeightSyntax === 'bracket' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-300 shadow' : 'text-gray-500 dark:text-gray-400'}`}
        >
            括号权重
        </button>
    </div>
    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p>数字：每次 +/- 调整 0.1，例如 <code className="font-mono">1.3::artist:name::</code></p>
        <p>括号：每次 +/- 调整一层，例如 <code className="font-mono">{{'{artist:name}'}}</code></p>
    </div>
</div>
```

若 JSX 中花括号示例导致解析不佳，改为普通字符串：`<code className="font-mono">{'{artist:name}'}</code>`。

- [ ] Verify GREEN: 运行 `npm run build`。期望构建通过。
- [ ] Commit: 不单独 commit；等待全部实现和验证通过后统一 commit。

### Task 4 — 支持数字语法导入闭环

Files:
- Modify: `components/ArtistLibrary.tsx`

Why:
- 用户复制出的数字权重可以再次导入，不让功能半截断。

Impact/Compatibility:
- 保持现有 `{}` / `[]` 导入。
- 新增 `1.3::artist:name::` 解析。
- 不做完整 Prompt parser，只解析单个逗号分隔 tag 中包裹完整 tag 的数字权重。

Steps:
- [ ] Write test: 手动导入清单：
  - `1.3::artist:known_name::` → step `3`
  - `0.8::artist:known_name::` → step `-2`
  - `{artist:known_name}` → step `1`
  - `[[artist:known_name]]` → step `-2`
- [ ] Verify RED: 当前 `handleImport` 只统计 `{}` / `[]`，数字语法不会提取权重。
- [ ] Minimal code: 在 `ArtistLibrary.tsx` 顶部纯函数区加入：

```ts
const parseNumericWeightedArtistTag = (raw: string): { name: string; step: number } | null => {
    const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)::(.+)::$/);
    if (!match) return null;

    const numericWeight = parseFloat(match[1]);
    if (!Number.isFinite(numericWeight)) return null;

    const step = clampArtistWeightStep(Math.round((numericWeight - 1) / ARTIST_WEIGHT_NUMERIC_STEP));
    return { name: match[2].replace(/^artist:/i, '').trim(), step };
};
```

在 `handleImport` 的 `tags.forEach(raw => { ... })` 开头改为：

```ts
tags.forEach(raw => {
    const numericParsed = parseNumericWeightedArtistTag(raw);
    let name = numericParsed ? numericParsed.name : raw.replace(/^artist:/i, '');
    let weight = numericParsed ? numericParsed.step : 0;

    if (!numericParsed) {
        const openBraces = (name.match(/\{/g) || []).length;
        const closeBraces = (name.match(/\}/g) || []).length;
        const openBrackets = (name.match(/\[/g) || []).length;
        const closeBrackets = (name.match(/\]/g) || []).length;

        if (openBraces > 0 && openBraces === closeBraces) {
            weight = clampArtistWeightStep(openBraces);
            name = name.replace(/[\{\}]/g, '');
        } else if (openBrackets > 0 && openBrackets === closeBrackets) {
            weight = clampArtistWeightStep(-openBrackets);
            name = name.replace(/[\[\]]/g, '');
        }
    }

    const matched = (artistsData || []).find(a => a.name.toLowerCase() === name.toLowerCase());
    ...
});
```

保留后续 matched / newItems 逻辑。

- [ ] Verify GREEN: 运行 `npm run build`。期望构建通过。
- [ ] Commit: 不单独 commit；等待全部实现和验证通过后统一 commit。

### Task 5 — 更新进度文档并执行最终验证

Files:
- Modify: `PROGRESS.md`
- Modify: `HANDOFF.md`
- Optional modify: `README.md`，仅当偏好设置说明已有对应段落时追加。

Why:
- 项目规约要求 session 结束更新进度和交接。

Impact/Compatibility:
- 不改变运行时代码。

Steps:
- [ ] Write test: 记录最终手动验证 checklist 到 `HANDOFF.md`，包括默认数字、切换括号、数字导入。
- [ ] Verify RED: 当前 `PROGRESS.md` / `HANDOFF.md` 没有军火库权重语法偏好记录。
- [ ] Minimal code: 在 `PROGRESS.md` 追加 2026-06-22 小节，记录：
  - 新增偏好 key `naipm.artistLibrary.weightSyntax`
  - 默认 `numeric`
  - `CartItem.weight` 语义为 step count
  - 范围 `-10..10`
  - 支持数字语法导入
  - 验证结果

  覆盖 `HANDOFF.md` 为最新 session 快照，保留：
  - 改动文件
  - 验证状态
  - 手动验证清单
  - 不触碰 Worker / D1 / R2

- [ ] Verify GREEN: 运行：

```bash
npm run build
```

期望输出包含：
- `✓ built` from Vite
- `Done` from esbuild
- 无 TypeScript error

- [ ] Commit: 用户明确要求 commit 时，提交：

```bash
git status --short
git add components/ArtistAdmin.tsx components/ArtistLibrary.tsx components/ArtistLibraryCart.tsx PROGRESS.md HANDOFF.md docs/aegis/README.md docs/aegis/INDEX.md docs/aegis/BASELINE-GOVERNANCE.md docs/aegis/baseline/2026-06-22-initial-baseline.md docs/aegis/plans/2026-06-22-artist-library-weight-syntax.md
git commit -m "feat(settings): 添加军火库权重语法偏好

默认使用 NovelAI 数字权重语法，并允许在偏好设置切换到花括号/方括号语法。军火库内部统一使用 step count，支持 -10 到 +10 范围和数字语法导入闭环。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Risks

- `ArtistLibrary.tsx` 体积已大，新增 helper 必须集中，避免继续在 JSX 中散落格式逻辑。
- `storage` event 在同一 tab 写 LocalStorage 时不会触发；如果用户在设置页切换后不刷新已打开的军火库 tab，只有跨 tab 会自动同步。同一 SPA 内从设置切回军火库时组件通常会重新 mount / 读取。若实际不是重新 mount，执行时需要在 `Layout` 层提升偏好状态或监听自定义事件；本计划先按现有页面切换模式验证。
- 导入 parser 不做完整嵌套 prompt 解析，只支持逗号分隔后的完整数字权重段。

## Retirement

- 无旧持久数据迁移。
- 旧括号行为保留为可选偏好，不删除。
- 若未来全 app 需要 NovelAI 权重 helper，应退休 `ArtistLibrary.tsx` 内局部 helper，抽为共享模块。

## Self-Review

- Spec coverage：覆盖默认数字、括号切换、`-10..10`、`0.1` 步长、数字导入。
- Placeholder scan：无未定义占位。
- Type consistency：`ArtistWeightSyntax = 'numeric' | 'bracket'`，父子 props 明确。
- Compatibility：不改 Worker / D1 / R2，不迁移历史。
- Plan-time complexity：已标记 `ArtistLibrary.tsx` 膨胀风险，并限制为局部纯函数。
- Verification：每个 slice 有 build 或手动检查；最终 `npm run build`。
- ADR / baseline：无 ADR 信号；已初始化 Aegis baseline 与 plan 索引。
