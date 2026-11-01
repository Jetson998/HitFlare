# 窄屏适配实施方案

本文是实现说明，不是视觉稿。不要参照对话里的低保真线框写界面：线框省略了按钮、把日期画成了另一套时间轴、把资产大图画成只有关闭。以本文和现有组件为准。

只改窄屏。达到下面已有断点之后，保持现在的桌面布局，不要新增断点。

- 应用顶栏：`@container/app`，小于 960px。
- 工作台左右分栏和历史侧栏：`@container/workbench`，小于 1100px。
- 列表页搜索和筛选：`@container page`，小于 767px。

不改画布编辑器 `/canvas/:id`。不改首页、登录、404 的内容。不改 Agent 的历史对话和阅读方案，除了下面写明的顶栏和方案标题。

## 1. 顶栏

适用所有走 `UserLayout` 且不是首页、不是画布编辑器的页面。窄屏下拉里现在已经有当前页下拉，但 Logo 容器是 `w-full shrink-0`，顶栏又是 `overflow-x-hidden`，下拉被裁掉。

小于 960px 时顶栏只留两样：

- Logo 用现有 `variant="mark"`，不要用侧栏横版。
- 当前页下拉，显示当前页名称，点开后是现有导航项。
- 设置、语言、主题、退出放进这个下拉的底部，不要再排在顶栏右侧。

960px 及以上仍是现在的左侧竖栏，展开和收起不变。

文件：`web/src/components/layout/app-side-nav.tsx`、`web/src/components/layout/user-status-actions.tsx`。

## 2. 图片、视频、反推的记录

宽屏继续用左侧历史栏，不要出现返回按钮。

小于 1100px 时，去掉右上角历史图标和底部 `Drawer`。改成和 Agent 窄屏一样：左侧返回按钮进入全屏记录列表，列表里的返回回到创作。图片页的「生成 / 场景模板」保留，返回按钮放在这一行左侧。视频页现在只有右侧历史按钮，改到左侧。反推页现在把历史按钮放在参考图标题旁，同样改成左侧返回进入记录。

记录内容仍用现有 `GenerationHistoryPanel`，不要新做列表。

文件：`web/src/pages/image/index.tsx`、`web/src/pages/video/index.tsx`、`web/src/pages/reverse-prompt/index.tsx`。

## 3. 资产

宽屏保持搜索、来源筛选、模态、收藏和宫格/时间轴切换。

小于 767px 时：

- 去掉搜索。
- 去掉「全部资产 / 上传素材 / 生成结果」。
- 去掉宫格和时间轴的切换，只显示现在的时间轴。
- 日期继续用现有 `assetDateFormatter`，例如「2026年10月31日」，旁边是现有的「N 项」。不要改成今天、昨天，也不要另做一条时间轴线。
- 模态筛选和「我的收藏」如果还在，放在时间轴上面，允许换行。不要为了窄屏删掉这两项。
- 点图片直接打开现有 `ImageLightbox`，使用 `variant="heavy"`，这样收藏、下载、关闭还在。不要再先打开 `AssetDetailsModal`。文字、视频、音频仍走现在的详情，不要套图片灯箱。

文件：`web/src/pages/assets/index.tsx`。

## 4. 大图预览

继续用 `ImageLightbox`。全屏、居中、点空白或 Esc 关闭、多图切换、旋转翻转缩放都保持，并且仍然只作用于预览，不改原图。

窄屏只改底部工具条：翻转、旋转、缩放保持原有按钮，放进一行，超出后横向滚动，不要挤出屏幕，也不要收成一个「更多」。左右切换按钮不要压住图片。

文件：`web/src/components/image-lightbox.tsx`。

## 5. 创作灵感

宽屏保持搜索和现在的大卡片。

小于 767px 时：

- 不显示搜索。
- 分类总览仍按分类分段，标题和「查看全部」保持。
- 卡片改成两列，只显示封面和标题。使用现有 `PromptCard` 的 `compact`，不要新做卡片。
- 「查看全部」进入该分类后，同样是两列封面，返回回到分类总览。
- 点卡片仍打开 `PromptDetailDialog`。窄屏下弹窗改为铺满视口：封面在上，提示词区域滚动，复制和加入资产固定在底部。宽屏仍是现在的 720 宽弹窗。首页里的同一弹窗跟着变。

文件：`web/src/pages/prompts/index.tsx`、`web/src/components/prompts/prompt-card.tsx`、`web/src/components/prompts/prompt-detail-dialog.tsx`。

## 6. 配置抽屉

配置弹窗的导入、导出允许换行。

渠道编辑抽屉和提示词来源抽屉：宽度用 `min(原宽度, 100vw)`。窄屏时标题单独一行，取消和保存从右上角移到抽屉底部。表单字段不改，中等宽度以下本来就是单列。

文件：`web/src/components/layout/app-config-modal.tsx`、`web/src/components/layout/channel-editor-drawer.tsx`、`web/src/components/layout/prompt-source-editor-drawer.tsx`。

## 7. 画布列表

只改 `/canvas` 列表，不改编辑器。标题行的导出、删除、导入、新建允许换行，选中项目后也不能把按钮挤出屏幕。

文件：`web/src/pages/canvas/index.tsx`。

## 8. 管理日志

筛选在最小宽度改为一列，640px 起两列，大屏保持现在的四到五列。标题旁的按钮允许换行。表格继续在表格内部横向滚动，不要改成卡片。日志详情抽屉在窄屏改为铺满视口宽度。

文件：`web/src/pages/admin/logs/index.tsx`。

## 9. Agent

历史和阅读方案不改。窄屏阅读方案时，右侧「分享」按自身宽度占位，标题在剩余空间里截断，不能压住标题。

文件：`web/src/components/agent/creative-agent-panel.tsx`。

## 不做

- 不改画布编辑器的工具条、侧栏、小地图。
- 不把线框里的灰色方块、假数据、红框做成界面。
- 不为窄屏新增断点、超时或尺寸限制。
- 不改视频的页内播放，不为视频再做一套灯箱。
