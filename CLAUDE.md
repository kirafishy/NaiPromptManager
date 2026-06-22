# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目本质

全栈 Serverless 应用：React 19 前端 + Cloudflare Workers 后端。运行时由 **Cloudflare Pages 单一 Worker** (`dist/_worker.js`) 同时服务静态资源和 `/api/*` 路由 —— 没有独立的 Pages Functions 目录，所有后端逻辑集中在 `worker/index.ts`（约 1100 行）。

## 常用命令

```bash
# 开发
npm run dev               # Vite dev server (端口 3000，仅前端，无 Worker)
npm run dev:local         # 完整本地栈（构建 + Wrangler Pages dev，模拟 D1/R2 到 ./local-data/）
npm run dev:local:watch   # 监听模式：并发跑 vite watch + esbuild watch + wrangler

# 构建与部署
npm run build             # tsc -b && vite build && build:worker
npm run build:worker      # esbuild 单独打包 worker → dist/_worker.js (ESM, browser platform)
npm run deploy            # 构建 + 创建 Pages 项目（幂等）+ wrangler pages deploy
```

**注意**：
- 没有测试框架，没有 lint 配置。验证靠 `tsc -b`（增量编译，输出 `tsconfig.tsbuildinfo`）和手动跑 `dev:local`。
- 修改 Worker 后必须 `npm run build:worker`，否则 `dev:local:quick` 用的是过时产物。
- `tsconfig.json` 设了 `noEmit: true`，TS 只做类型检查；JS 产物由 Vite/esbuild 各自处理。

## 关键架构

### 1. 单文件 Worker (worker/index.ts)
所有 API 路由用一个大 switch 处理，依赖注入的 `Env` 包含：
- `DB`：D1 数据库绑定（用户、会话、Chain、画师、灵感图、settings、access_logs、daily_stats）
- `BUCKET`：R2 绑定（封面图、灵感图原图）
- `ASSETS`：Pages 静态资源 fetcher（fallback 到 SPA）

Worker 启动时调用 `initializeDatabase()`（worker/index.ts:66 附近）自动建表/迁移，所以 schema.sql 是参考文档而非真正的 source of truth。运行迁移脚本 (`migration_*.sql`) 时要核对 worker 里的 init 逻辑是否已包含。

### 2. 数据模型分层
- **云端 (D1 + R2)**：Chain（提示词链）、Artist（画师）、Inspiration（灵感图）、User/Session
- **本地 (IndexedDB)**：GenHistory（生成历史，原始实现非 Dexie），保护隐私，可"发布"到云端灵感图库
- **本地 (LocalStorage)**：NAI API Key、暗色模式偏好

### 3. Prompt 编译流水线
`services/promptUtils.ts` 定义核心顺序：**Base → Pre-Modules → {subject} → Post-Modules**。模块通过 `position: 'pre' | 'post'` 控制插入位置；`{subject}` 变量来自 `variableValues`，默认 `'1girl'`。

### 4. 服务层 (services/)
- `dbService.ts`：所有 `/api/*` 调用的薄封装（fetch + JSON）
- `naiService.ts`：NAI V4.5 特定参数处理（包括 `seed: -1` ⇄ 缺失 seed 的随机语义）
- `localHistory.ts`：IndexedDB 原始 API（无 Dexie 等封装）
- `metadataService.ts`：从 PNG 解析 NAI 元数据（用于上传时自动填充）
- `promptUtils.ts`：编译/解析提示词字符串

### 5. 认证
- 默认管理员 `admin` / `admin_996`（首次启动建议改密）
- 会话：HttpOnly Cookie，`sessions` 表管理过期
- 游客口令：存在 D1 `settings` 表（**不是**环境变量，`wrangler.toml` 里的 `GUEST_PASSCODE` 已弃用）
- 密码：bcryptjs hash
- 普通用户配额 300MB（worker/index.ts:119 附近）

### 6. 路径别名
`@/` → 项目根目录（`vite.config.ts:19`）。TS/Vite 都识别，组件里写 `import x from '@/services/foo'`。

## 非显而易见的陷阱

1. **重复读取 request body**：Worker 里 `request.json()` 只能调一次（参考 commit `6121245`），处理 inspirations 时要先读到变量再分发。
2. **数据库迁移幂等性**：worker 启动初始化时部分 `ALTER TABLE ADD COLUMN` 用 try/catch 忽略已存在的错误（参考 commit `884aeb4`、`d66872b`）。改 schema 时跟随这个模式。
3. **游客切换状态**：登出/切换用户时需要清除前端本地缓存的非游客可见数据（参考 commit `bdf76d8`、`dfe1fc1`）；`chains` 等结构有 "游客不可见" 标记。
4. **本地数据 vs 云端数据完全隔离**：`./local-data/` 由 wrangler `--persist-to` 管理，重启保留但不上传。
5. **前端缓存 TTL**：1 小时（`App.tsx:15` 附近）。改后端数据形状时记得让前端缓存键变化或清理。
6. **图片上传链路**：前端 Base64 → Worker → R2 → 返回 `/api/assets/<key>` 路径；不要直接暴露 R2 公网 URL。
7. **Worker 是 browser platform**：esbuild 打包用 `--platform=browser`，不能用 Node API；bcryptjs 选了纯 JS 版本就是为此。

## 环境变量

- `GEMINI_API_KEY`：Vite 启动时注入到 `process.env.API_KEY` 和 `process.env.GEMINI_API_KEY`（`vite.config.ts:14`）
- NAI API Key：仅前端 LocalStorage，运行时通过 `Authorization` Header 透传给 Worker，**Worker 不存**

## 部署前检查

1. `wrangler.toml` 里 `database_id` 和 `bucket_name` 已填实际值
2. Cloudflare Pages 项目已绑定 `DB` (D1) 和 `BUCKET` (R2) 变量
3. `npm run build` 本地能通过（tsc + vite + esbuild 三步都成功）
