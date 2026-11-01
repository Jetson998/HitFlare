# 无限画布文档索引

## 项目介绍

- [快速开始](/zh-CN/docs/overview/quick-start)
- [功能介绍](/zh-CN/docs/overview/features)
- [Render 部署](/zh-CN/docs/overview/render)
- [Docker 部署](/zh-CN/docs/overview/docker)
- [第三方提示词来源](/zh-CN/docs/overview/third-party-prompt-repositories)

## 操作手册

- [画布节点操作手册](/zh-CN/docs/canvas/canvas-node-manual)
- [画布快捷键](/zh-CN/docs/canvas/canvas-shortcuts)

## 开发与数据

- [HitFlare 服务化方案复审（基于 v0.18.3 线上代码）](hitflare/SERVICEIZATION_CURRENT_RELEASE_REVIEW.md)
- [HitFlare 服务化阶段成果与验收记录](hitflare/SERVICEIZATION_STAGE_HISTORY.md)
- [HitFlare 服务化分阶段开发与本地化测试计划](hitflare/SERVICEIZATION_PHASED_DEVELOPMENT_LOCAL_TEST_PLAN.md)
- [HitFlare P1 基础底座交付与人工验收](hitflare/SERVICEIZATION_P1_ACCEPTANCE.md)
- [HitFlare P2 配置与数据交付及人工验收](hitflare/SERVICEIZATION_P2_ACCEPTANCE.md)
- [HitFlare P3 生成与调用交付及人工验收](hitflare/SERVICEIZATION_P3_ACCEPTANCE.md)
- [HitFlare P4 画布与引用交付及人工验收](hitflare/SERVICEIZATION_P4_ACCEPTANCE.md)
- [HitFlare P5 管理、恢复与总回归交付及人工验收](hitflare/SERVICEIZATION_P5_ACCEPTANCE.md)
- [HitFlare P6 联调收尾与集中验收准备](hitflare/SERVICEIZATION_P6_ACCEPTANCE.md)
- [HitFlare 服务化开发排期与权限、用户体系对接方案](hitflare/SERVICE_COLLABORATION_PERMISSION_INTEGRATION_PLAN.md)
- [HitFlare 服务化与权限体系验收测试用例](hitflare/SERVICE_AND_PERMISSION_ACCEPTANCE_TEST_CASES.md)
- [HitFlare 后端需求清单：权限依赖与用户数据服务端化](hitflare/BACKEND_ASSET_CANVAS_SERVICE_REQUIREMENTS.md)
- [HitFlare 多租户多用户、数据隔离与权限方案](hitflare/MULTI_TENANT_USER_DATA_ISOLATION_PLAN.md)
- [HitFlare 反推提示词功能方案](hitflare/REVERSE_PROMPT_FEATURE_PLAN.md)
- [HitFlare 视觉拆解与反推提示词升级方案（图片优先）](hitflare/VISUAL_ANALYSIS_AND_REVERSE_PROMPT_UPGRADE_PLAN.md)
- [图片视觉分析服务前端接入](hitflare/VISUAL_ANALYSIS_FRONTEND_INTEGRATION.md)
- [本地开发](/zh-CN/docs/development/local-development)
- [画布数据结构](/zh-CN/docs/development/canvas-data-structure)

## 商务合作

- [开源协议](/zh-CN/docs/business/license)
- [商务合作](/zh-CN/docs/business/business)

## 支持与安全

- [漏洞提交](/zh-CN/docs/support/security)
- [赞助支持](/zh-CN/docs/support/sponsor)

## 项目进度

- [更新日志](/zh-CN/docs/progress/changelog)
- [待测试](/zh-CN/docs/progress/pending-test)
- [TODO](/zh-CN/docs/progress/todo)

## 说明

- 已部署基线仍使用浏览器本地资产和画布；本地 P2～P6 候选已接入按账号归属的服务端存储并停用旧浏览器 WebDAV，待集中人工验收。
- 本地候选将 API Key 加密保存于服务端；浏览器直连模型时通过本人鉴权 runtime-secret 读取，Agent/反推由服务端解析凭据。

## 原理说明

- [本地 Codex 连接画布原理](/zh-CN/docs/development/local-codex-canvas)
