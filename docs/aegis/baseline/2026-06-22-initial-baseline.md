# NAI Prompt Manager Initial Baseline

Date: `2026-06-22`
Status: `initial dual-baseline snapshot`

## 1. Purpose

- 为后续 Aegis 对齐检查提供初始产品与架构证据。
- 明确当前项目的主要 owner、runtime boundary 与兼容边界。

## 2. Workspace Structure

- `components/`：React 19 前端 UI 与页面级 owner。
- `services/`：前端服务封装、本地存储、Prompt 工具与 NAI 调用。
- `worker/index.ts`：Cloudflare Pages 单一 Worker，集中处理 `/api/*` 与静态资源 fallback。
- `docs/adr/`：已存在架构决策记录。
- `HANDOFF.md`：最近一次 session 快照。
- `PROGRESS.md`：长期进度与决策日志。

## 3. Current Authority Surfaces

- `CLAUDE.md`：项目架构、命令、陷阱与验证要求。
- `HANDOFF.md` / `PROGRESS.md`：当前实现状态和历史决策。
- `docs/adr/0001-jpg-compaction-discards-nai-metadata.md`：JPG 压缩元数据取舍。
- 用户在对话中批准的需求与设计选择。

Authority gaps:
- 项目没有测试框架和 lint 配置。
- `schema.sql` 是参考文档，Worker 初始化逻辑才是数据库 source of truth。

## 4. Product / Requirement Baseline

### 4.1 Current Truth

- 项目是 NAI Prompt Manager，全栈 Serverless 应用。
- 用户通过前端管理提示词链、画师库、灵感图库、本地生成历史与偏好。
- 本地历史、NAI API Key、部分偏好保留在浏览器端。

### 4.2 Non-negotiables

1. 用户可见行为必须可通过构建或手动运行验证。
2. 本地偏好不应误写到云端，除非需求明确要求同步。
3. 现有游客 / 管理员 / VIP 权限边界不能被偏好功能破坏。

### 4.3 Product Non-goals

- 不在无明确需求时重写全局 prompt 编译器。
- 不在纯前端偏好任务中变更云端 schema。

## 5. Architecture / Runtime Boundary Baseline

### 5.1 Current Truth

- React 前端和 Cloudflare Worker 后端通过 `/api/*` 边界通信。
- `worker/index.ts` 是 D1 初始化、迁移和后端 API 的 source of truth。
- `services/dbService.ts` 是前端 API 薄封装。
- `services/promptUtils.ts` 是 Prompt 编译顺序 owner。
- `components/ArtistAdmin.tsx` 当前承载“设置 → 偏好设置”。
- `components/ArtistLibrary.tsx` 当前承载“军火库”页面逻辑。

### 5.2 Architecture Non-negotiables

1. Worker 是 browser platform，不能引入 Node API。
2. 数据形状必须在外部边界验证。
3. 本地历史与云端数据保持隔离。
4. 图片通过 Worker / R2 路径暴露，不直接暴露 R2 公网 URL。

### 5.3 Architecture Non-goals

- 不为单个轻量偏好创建后端接口。
- 不在 UI-only 任务中改变 D1 / R2 owner。

## 6. Ownership / Contract Snapshot

- 偏好设置 UI -> `components/ArtistAdmin.tsx`
- 军火库 UI / 购物车状态 -> `components/ArtistLibrary.tsx`
- 军火库底部已选条 UI -> `components/ArtistLibraryCart.tsx`
- Prompt 编译 -> `services/promptUtils.ts`
- API fetch 封装 -> `services/dbService.ts`
- Worker API / schema init -> `worker/index.ts`

## 7. Current State and Risks

- 最近 JPG 压缩功能已实现并通过 build，但 `dev:local` 手动验证仍待执行。
- `ArtistLibrary.tsx` 已较大，新增逻辑应保持局部纯函数，避免继续膨胀。
- 项目无测试框架，完成定义依赖 `npm run build` 与手动检查。

## 8. Alignment Use

- 涉及用户工作流和偏好行为时，读取 Product / Requirement Baseline。
- 涉及 Worker、D1、R2、Prompt 编译顺序或 owner 变更时，读取 Architecture / Runtime Boundary Baseline。
- 同时改变用户行为与 owner / contract 时，报告 `scope: both`。

## 9. Compatibility Boundary

- 不破坏现有登录、游客模式、画师管理、灵感图库和本地历史。
- 不改动云端数据结构，除非需求明确。
- 不重写用户已有 LocalStorage 历史数据，除非有迁移计划和用户确认。
