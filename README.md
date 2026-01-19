
# 🎨 NovelAI Prompt Manager (NAI 助手)

<div align="center">

![Version](https://img.shields.io/badge/version-0.2.2-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![React](https://img.shields.io/badge/react-19.0-61dafb.svg)
![Cloudflare](https://img.shields.io/badge/cloudflare-workers-orange.svg)

**专业级 NovelAI 提示词管理工具 | 支持 Cloudflare Workers 部署**

[🚀 立即部署](#-快速部署) · [✨ 功能特性](#-核心功能) · [📖 使用文档](#-使用指南) · [🎨 演示](#-功能演示)

</div>

---

## 🌟 项目简介

NovelAI Prompt Manager 是一个专为 NovelAI 用户打造的现代化提示词管理平台。它采用类似代码管理的「Prompt Chain」概念，支持版本控制、模块化组合和变量替换，助你构建稳定、可复用的魔法咒语库。

### 💡 为什么选择 NAI 助手？

- ⛓️ **Prompt Chain** - 像管理代码一样管理提示词，支持版本回溯与迭代
- 🧩 **模块化设计** - 将光影、构图、人物特征拆分为独立模块，灵活开关
- 🔧 **变量系统** - 支持 `{character}`、`{outfit}` 等动态变量，一套模板无限生成
- 🎨 **画师军火库** - 内置权重计算、Gacha 随机抽取、批量导入功能
- 🖼️ **灵感图库** - 拖入 PNG 自动读取 NAI 生成元数据（Prompt/Seed）
- 🌗 **深色模式** - 舒适的夜间创作体验，自动跟随系统或手动切换
- 🔒 **隐私安全** - 数据完全存储在浏览器本地 (IndexedDB/LocalStorage)，无后端依赖
- ☁️ **云端部署** - 纯静态架构，支持零成本部署至 Cloudflare Workers/Pages

---

## ✨ 核心功能

### 🛠️ 创作工作流

| 功能 | 说明 | 适用场景 |
|------|------|----------|
| 📝 **版本管理** | 记录每一次 Prompt 修改 | 对比不同版本的生成效果 |
| 🔢 **变量替换** | 定义占位符并实时填充 | 快速切换角色/服装/场景 |
| 🧪 **实时预览** | 集成 NAI API (V4.5) 直接生成 | 调整参数后立即验证 |
| 📦 **模块组合** | 勾选激活不同模块 | 测试不同画风/光影组合 |

### 📚 资源管理

- **画师管理**：支持权重语法 `{}` `[]`，支持 `artist:` 前缀开关，提供随机抽取灵感功能。
- **灵感解析**：自动解析 NAI 生成图片的 PNG Metadata，一键复制 Prompt。
- **历史记录**：自动保存复制历史，防止灵感丢失。

---

## 🚀 快速部署

本项目采用纯前端架构（React + Vite），可以轻松部署到 Cloudflare Pages 或通过 Wrangler 部署到 Workers。

### 方法一：一键部署到 Cloudflare Pages（推荐）

1. **Fork** 本仓库到你的 GitHub。
2. 登录 Cloudflare Dashboard，进入 **Pages**。
3. 选择 **Connect to Git**，选中本仓库。
4. 构建设置：
   - **Framework Preset**: Vite / Create React App
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. 点击 **Save and Deploy**。

### 方法二：通过 Wrangler CLI 部署

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/nai-prompt-manager.git
cd nai-prompt-manager

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build

# 4. 部署到 Cloudflare Pages
npx wrangler pages deploy dist --project-name=nai-pm
```

---

## 📖 使用指南

### 1. 配置 API Key
首次进入应用，在编辑器右上角输入你的 NovelAI API Key。
> 🔑 Key 仅存储在你的浏览器本地 LocalStorage 中，不会上传到任何服务器。

### 2. 创建 Chain (提示词链)
1. 点击首页「新建 Chain」，输入名称（如「日系厚涂风」）。
2. 进入编辑器，设置 **Base Prompt**（通用起手式）。
3. 添加 **Modules**（如「光照模块」、「背景模块」），设置是否默认激活。
4. 在 Prompt 中使用 `{变量名}` 挖坑，例如 `1girl, {action}, {location}`。

### 3. 生成与迭代
1. 在右侧「变量填充」区填入内容（如 `{action}: sitting`）。
2. 点击「生成预览」调用 NAI 绘图。
3. 满意后点击「保存版本」固化当前配置。

### 4. 进阶功能
- **设为封面**：在生成预览成功后，点击图片右上角的按钮将其设为当前 Chain 的封面。
- **画师购物车**：在画师军火库中点击画师加入购物车，调整权重，最后复制组合串。

---

## 🛠️ 技术栈

- **Core**: React 19, TypeScript
- **Styling**: Tailwind CSS
- **Storage**: LocalStorage / IndexedDB Simulation
- **API**: NovelAI Official API (Image Generation)
- **Utilities**: JSZip (Response Parsing)

---

## ❤️ 致谢

本项目的部分灵感与资源设计（画师军火库、灵感图库模块）致敬并参考了 [nai-artists](https://github.com/twoearcat/nai-artists) 项目，特此感谢原作者的优秀工作。

---

## 📄 开源协议

本项目采用 [MIT License](./LICENSE) 开源协议。

---

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！**

</div>
