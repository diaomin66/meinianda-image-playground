# Meinianda Image Playground

一个浏览器端的无限画布、GPT Image、Gemini Image、Agent 与人物聊天工作台。默认进入画布库，配置和任务保存在当前浏览器；手动导出或启用 WebDAV 后可保留外部备份。

当前版本：**0.9.0-beta.1（测试版）**。更新说明：[人物（beta）、并发生图与交互优化](docs/release-0.9.0-beta.1.md)。

## 人物（beta）

- 创建人物，填写名字、人格和外貌，可单独上传头像及多张生图参考图；未上传头像时显示名字中的最多两个字。
- 在「设置 → API 配置」填写密钥，再在「人物配置（beta）」选择聊天模型、默认生图配置、画幅与提示词优化副脑。
- 支持 OpenAI Responses 与 Gemini 原生流式聊天，人格原文是唯一系统提示词。普通对话和副脑不接收固定参考图像素；参考图直接用于生图。
- 主 Agent 调用工具发起图片任务，副脑逐张优化提示词，多张图片并发生成并回到原对话；聊天保持自然交流，详细过程在对话日志中查看。
- 支持独立历史对话、批量删除、相册、日志筛选与导出。生活日程按人物设定的每日切换时间划分日期，在聊天时生成当天状态，也可手动重写。
- 人物资料、聊天和图片纳入全局数据备份。beta 阶段建议先备份再升级；后台生成依赖浏览器页面保持打开，关闭或刷新会中断请求。

## 工作区与数据恢复

画廊、全局 Agent、人物和无限画布共用 API 配置。画廊任务与画布项目使用独立存储，画布生图不会自动添加画廊任务。全局 Agent、人物与 Canvas Agent 的对话各自保存。

| 入口 | 备份范围 | 恢复入口 |
| --- | --- | --- |
| 全局设置 → 数据管理 | 所选的宿主配置、画廊任务、图片、全局 Agent 对话、人物资料与聊天图片 | 同页导入数据 |
| 画布库 → 全部导出（含 Agent） | 全部画布、项目引用媒体、Canvas Agent 对话及附件；不含 API Key 和独立资产库 | 画布库 → 导入画布 |
| 画布导出选中／单项目导出 | 所选项目与引用媒体，不含独立 Canvas Agent 对话 | 画布库 → 导入画布 |
| 画布设置 → WebDAV | 画布、独立资产、工作台记录与媒体；不含 API Key、宿主任务及 Canvas Agent 对话 | 同一 WebDAV 配置下手动同步 |

- 生成中可以返回列表或切到画廊，结果仍保存到原项目。关闭或刷新浏览器页面会中断当前前端请求。
- 画布顶部显示实际保存状态；保存失败可点击重试。只保留在内存中的图片会单独提示，请及时下载。
- 导入先检查格式和资源完整性，再创建新项目及独立资源键；旧项目不会被覆盖。存储失败时请保留页面，按提示重试保存或导出。
- WebDAV 当前采用合并备份语义，不传播删除标记：之前已备份、后来本地删除的项目可能再次被合并回来。Canvas Agent 对话请使用画布库的完整导出入口。
- 离线时可使用已经缓存的界面和本地内容，模型调用仍需要网络。清除站点数据前，应分别备份宿主数据和画布数据。
- 画廊每页显示 90 个任务，选择可以跨页保留；框选作用于当前页可见卡片。

## 固定 API 配置

- 生图配置：固定服务地址 `https://meinianda.top/v1`，使用 Images API 的 `/v1/images/generations` 和 `/v1/images/edits`；画廊与画布可选 `gpt-image-2`（原默认）、`gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。
- Gemini 生图配置：固定服务地址 `https://meinianda.top/v1beta`，固定使用 `generateContent API (/v1beta/models/{model}:generateContent)`；画廊可选 `gemini-3.1-flash-image` 和 `gemini-3-pro-image`。
- 语言配置：固定服务地址 `https://meinianda.top/v1`，固定使用 `Responses API (/v1/responses)` 和 `gpt-5.6-sol`。
- Gemini 语言配置：固定服务地址 `https://meinianda.top/v1beta`，使用原生 `streamGenerateContent?alt=sse` 接口，供人物聊天与副脑选择；语言模型可在人物配置中设置。
- 四项配置分别填写 API Key；固定地址、服务商和接口类型不可修改。
- 画廊根据模型选择自动切换 GPT/Gemini 生图配置；Agent 继续使用语言配置处理对话，并使用 GPT 生图配置创建图片。
- 参数控件按当前值自动调整宽度；输入栏会根据 GPT、Gemini Flash 和 Gemini Pro 的参数数量平滑拉长或缩短。

GPT Image 2.5 参数（2026-09-09 核对 OpenAI 官方图像生成指南）：

- 两个 2.5 模型的 `quality` 支持 `auto`（默认）、`low`、`medium`、`high`、`xhigh`、`max`。切回 GPT Image 2 时，后两档自动降为 `high`。
- 尺寸支持 `auto` 和自定义宽高；边长不超过 3840、为 16 的倍数、长短边比不超过 3:1，总像素介于 655,360 与 8,294,400。已有 4K 预设包括 `3840x2160` 和 `2160x3840`；官方将高于 `2560x1440` 的分辨率标为实验性。GPT Image 2 的官方尺寸约束也相同。
- `background` 支持 `auto`、`opaque`、`transparent`；原生透明图选择 `transparent` 和 PNG（或 WebP），无需开启“透明输出增强”。JPEG 不支持透明背景。
- 模型与质量选择会保存到当前浏览器；两个 2.5 模型之间切换保留尺寸与质量。固定服务的实际模型可用性以服务端为准。
- 官方来源：`https://developers.openai.com/api/docs/guides/image-generation`、`https://developers.openai.com/api/docs/models/gpt-image-2.5-flare`、`https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst`。

## Vercel 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdiaomin66%2Fmeinianda-image-playground&project-name=meinianda-image-playground&repository-name=meinianda-image-playground)

点击按钮导入仓库即可部署。无需设置 API 地址环境变量；用户在页面设置中填写 API Key 后即可使用。

## 本地开发

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

## 许可

宿主许可见根目录 `LICENSE`（MIT）；集成画布保留的上游许可见 `src/infiniteCanvas/LICENSE`（GNU AGPL v3）。
