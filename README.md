<p align="center">
  <img src="web/public/brand/hitflare-icon-v2.png" width="96" alt="HitFlare 光引 logo">
</p>

<h1 align="center">光引 · HitFlare</h1>

<p align="center">
  <a href="https://linux.do/"><img src="https://img.shields.io/badge/Linux.do-Community-2b6de8?style=flat-square" alt="Linux.do"></a>
  <a href="https://render.com/deploy?repo=https://github.com/Jetson998/HitFlare"><img src="https://img.shields.io/badge/Render-Deploy-46e3b7?style=flat-square&logo=render&logoColor=111111" alt="Render 部署"></a>
  <a href="https://github.com/Jetson998/HitFlare"><img src="https://img.shields.io/github/stars/Jetson998/HitFlare?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/Jetson998/HitFlare/tags"><img src="https://img.shields.io/github/v/tag/Jetson998/HitFlare?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://reactrouter.com/"><img src="https://img.shields.io/badge/React_Router-7-ca4245?style=flat-square&logo=reactrouter&logoColor=white" alt="React Router"></a>
</p>

<p align="center">
<a href="https://github.com/Jetson998/HitFlare" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Jetson998%2FHitFlare-Repository-181717?style=flat-square&logo=github" alt="Jetson998/HitFlare" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> · <a href="docs/content/docs/overview/features.mdx">功能介绍</a> · <a href="docs/content/docs/overview/render.mdx">Render 部署</a> · <a href="docs/content/docs/overview/docker.mdx">Docker 部署</a> · <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布节点操作手册</a> · <a href="docs/content/docs/canvas/canvas-shortcuts.mdx">画布快捷键</a> · <a href="SECURITY.md">漏洞提交</a> · <a href="docs/content/docs/progress/todo.mdx">待办事项</a> · <a href="canvas-agent/README.md">本地 Canvas Agent</a> · <a href="plugins/infinite-canvas">Codex app 插件</a>
</p>

光引（HitFlare）是一款面向图片创作的本地工作台。它把图片生成、图生图、场景模板、创作灵感、画布编排、对话助手和素材沉淀放在同一个界面里。

> 热流即引，创作即闪耀。
> Guided by Flare, Created to Shine.

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种本地存储格式都可能直接调整，欢迎关注后续更新。
>
> 如果你需要稳定维护自己的分支，建议自行 fork 后独立开发。二次开发与 PR 请保留原作者信息和前端页面标识。

## 赞助商

<table>
  <tr>
    <td width="190" align="center">
      <a href="https://www.atlascloud.ai/zh?utm_source=github&utm_medium=link&utm_campaign=infinite-canvas" target="_blank" rel="noopener noreferrer"><img src="assets/atlascloud.svg" width="163" alt="Atlas Cloud"></a>
    </td>
    <td>
      <a href="https://www.atlascloud.ai/zh?utm_source=github&utm_medium=link&utm_campaign=infinite-canvas" target="_blank" rel="noopener noreferrer">Atlas Cloud</a> is a full-modal AI inference platform that gives developers a single AI API to access video generation, image generation, and LLM APIs. Instead of managing multiple vendor integrations, you connect once and get unified access to 300+ curated models across all modalities. Check out <a href="https://www.atlascloud.ai/console/coding-plan" target="_blank" rel="noopener noreferrer">Atlas Cloud's new coding plan promotion</a> for more budget-friendly API access.
    </td>
  </tr>
  <tr>
    <td width="190" align="center">
      <a href="https://metaso.cn/minimax-h3/?s=inf" target="_blank" rel="noopener noreferrer"><img src="assets/metaso.jpg" width="163" alt="秘塔科技"></a>
    </td>
    <td>
      <strong>MiniMax H3 视频生成 API｜秘塔科技</strong> 秘塔科技提供高性价比的 MiniMax H3 视频生成服务：<strong>768P 仅 0.09 元/秒，2K 仅 0.15 元/秒</strong>。支持原生 2K、音画同步，API 兼容 <strong>OpenAI 协议</strong>，同时支持 <strong>ComfyUI</strong>，无需自行部署 GPU。 🎁 通过 <a href="https://metaso.cn/minimax-h3/?s=inf" target="_blank" rel="noopener noreferrer">无限画布专属链接注册</a>，即可领取赠送额度及专属优惠。
    </td>
  </tr>
  <tr>
    <td width="190" align="center">
      <a href="https://www.infistar.cc/register?aff=4X3V9NA9&ref_source=link" target="_blank" rel="noopener noreferrer"><img src="assets/infistar.png" width="163" alt="Infistar.ai 无限星河"></a>
    </td>
    <td>
      <strong>无限画布 × Infistar.ai 无限星河｜内置原生画布 · 全能多模态 API</strong> 💡 原生集成，即点即用： Infistar.ai 已原生上架无限画布！同时提供低至官方 1 折的稳定 API 中转服务，模型倍率与调用明细全程透明。 🎨 多模态生图/生视频： 完美适配 Seedance、FLUX、Midjourney、Sora、Runway、Luma、可灵（Kling）等顶级图片与视频大模型。 🧠 全系语言模型： 覆盖 OpenAI、Claude、Gemini、Grok、DeepSeek、Qwen、GLM 等国内外主流模型，兼容 OpenAI 标准接口。 ⚡ 动态调度： 多路供应保障高可用，拒绝断连。 🎁 专属福利： 通过 <a href="https://infistar.ai/register?aff=4X3V9NA9&ref_source=link" target="_blank" rel="noopener noreferrer">专属链接</a> 注册，立享赠送额度/专属折扣/首充权益！
    </td>
  </tr>
 <tr>
    <td width="190" align="center">
      <a href="https://heyroute.ai/basketikun" target="_blank" rel="noopener noreferrer"><img src="assets/heyroute.svg" width="163" alt="HeyRoute"></a>
    </td>
    <td>
      <strong>无限画布 × HeyRoute｜全能多模态 API 服务商</strong>
      💡&nbsp;HeyRoute 深度接入无限画布，将创意构思、图片生成、视频制作与内容开发融为一体，让每个灵感都能快速落地。
      🎨&nbsp;多模态创作能力： 支持 AI 生图、生视频、图像编辑及内容生成，兼容 Seedance、MiniMax-H3、Image-2、Grok Video、Flux Klein、Gemini 等主流模型。
      🧠&nbsp;丰富模型生态： 覆盖 OpenAI、Claude、Gemini、Grok、DeepSeek、Qwen、GLM 等语言模型，并兼容 OpenAI 标准接口。
      ⚡&nbsp;稳定高效调用： 支持多模型、多线路灵活调度，调用记录清晰透明，满足日常创作、应用开发与批量生产需求。
      🎁&nbsp;专属福利： 通过 <a href="https://heyroute.ai/basketikun">专属链接</a> 注册，即可领取新用户 15 美元试用额度！
    </td>
  </tr>
  <tr>
    <td width="190" align="center">
      <a href="https://www.packyapi.com/register?aff=34VV" target="_blank" rel="noopener noreferrer"><img src="assets/packycode.png" width="163" alt="PackyCode"></a>
    </td>
    <td>
      <strong>无限画布 × PackyCode｜稳定高效的 API 中转服务商</strong>
      💡&nbsp;PackyCode 是一家稳定、高效的 API 中转服务商，提供 Claude Code、Codex、Gemini 等多种中转服务，让 AI 编程成为真正的生产力工具。
      ⚡&nbsp;稳定高效： 具备自动故障转移、智能路由和无限并发等多种功能，保障调用稳定可靠。
      🎁&nbsp;专属福利： 通过 <a href="https://www.packyapi.com/register?aff=34VV" target="_blank" rel="noopener noreferrer">专属链接</a> 注册，立即开始使用！
    </td>
  </tr>
</table>

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- AI 创作：浏览器前台直连你配置的 OpenAI 兼容接口，支持文生图、图生图、参考图编辑、文本问答、音频和视频生成。
- 画布助手：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- 本地 Agent：通过本机 Canvas Agent 连接 Codex / Claude Code，让 Agent 通过 MCP 操作当前画布；
- Codex App 插件：提供 Codex app 插件，安装后会自动注册 MCP 并尝试拉起本地 Agent。
- 插件系统：支持通过 URL 动态安装 / 启用 / 更新 / 卸载远程节点插件，并提供 TypeScript SDK 自行开发画布节点插件。
- 自定义接口调用：可自定义生图 / 视频接口的调用方式，灵活适配各类中转站与自建服务。
- 创作灵感：保留外部灵感源，并增加场景模板分类；模板与生成记录仍按本地工作台方式保存。

完整功能说明见 [功能介绍](docs/content/docs/overview/features.mdx)。

如果你在为担心没有合适的生图API来发愁，可以查看该免费生图项目：[chatgpt2api](https://github.com/basketikun/chatgpt2api)

## 快速开始

HitFlare 使用独立账号登录，暂不开放注册，由管理员在站内创建用户。账号与登录时间保存在服务端 SQLite；AI API Key、Base URL、画布、素材和生成记录仍保存在各用户自己的浏览器本地。

### 本地开发

```bash
HITFLARE_ADMIN_EMAIL=admin@example.com \
HITFLARE_ADMIN_USERNAME=管理员 \
HITFLARE_ADMIN_PASSWORD='替换为首次管理员密码' \
PORT=3002 node server/index.mjs
```

另开终端启动前端：

```bash
cd web
npm install --legacy-peer-deps
npm run dev
```

### 本地整合服务

前端构建完成后，使用项目内的 Node 服务同时提供静态页面和模板 API：

```bash
cd web
npm install --legacy-peer-deps
cd ..
cd web && npm run typecheck && npm run build
cd ..
scripts/ops/local-app.sh start
scripts/ops/local-app.sh status
```

访问 [http://localhost:3000](http://localhost:3000) 并使用首次管理员邮箱登录。管理员环境变量只在数据库中还没有管理员时用于初始化；账号数据库默认保存在 `data/hitflare.sqlite`。日志和 PID 保存在 `.local/`，可用 `scripts/ops/local-app.sh stop` 停止本项目自己启动的服务。

### Docker 运行

```bash
git clone git@github.com:Jetson998/HitFlare.git
cd HitFlare
cp .env.example .env
# 编辑 .env，填写 HITFLARE_ADMIN_EMAIL 和 HITFLARE_ADMIN_PASSWORD
docker compose up -d --build
```

运行后默认端口 3000，可访问 `http://localhost:3000`。Docker 会把账号数据库保存在 `hitflare-data` 数据卷中。

管理员登录后可从主菜单最后一项「用户管理」创建受邀用户、编辑信息和角色、重置密码以及禁用或启用账号。每位用户使用唯一邮箱登录，登录后进入「配置」，填入自己的 OpenAI 兼容 `Base URL` 和 `API Key`。

如果默认的OpenAI接口调用方式与您的API不同，可自定义生图/视频脚本调用。

## 效果展示

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/TDFvGWDT/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zVwJq3YS/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/PvY3qhhK/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/7D04LwN/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/bj30FtS5/5.png" alt="5" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/hxRvjw51/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/jkWsF8q1/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/XrnfXHx7/image.png" alt="image" border="0"></td>
  </tr>
</table>

## 联系方式

项目定制二次开发需求 / 生图 API 需求可联系。

邮箱：1844025705@qq.com · QQ：1844025705

## 赞助支持

本项目长期开放广告赞助合作，欢迎品牌 / 产品投放，你的支持是持续更新的动力！

有广告赞助意向请通过上方联系方式沟通。

## 社区支持

学 AI，上 L 站：[LinuxDO](https://linux.do/)

点击链接加入群聊【开源无限画布(2群)】：https://qm.qq.com/q/HRt2kUnYiG

## 开源协议

本项目使用 [MIT License](LICENSE)。任何人都可以免费使用、复制、修改、分发、再授权和商业使用本项目，也可以用于闭源产品。

## Star History

<a href="https://www.star-history.com/?repos=Jetson998%2FHitFlare&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Jetson998/HitFlare&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Jetson998/HitFlare&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Jetson998/HitFlare&type=date&legend=top-left" />
 </picture>
</a>
