# 固定配置说明

应用内置三项固定 API 配置。

- 生图配置使用 Images API 的 `/v1/images/generations` 和 `/v1/images/edits`，模型可选 `gpt-image-2`（默认）、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`，供画廊、画布生成和编辑图片。
- Gemini 生图配置固定使用 `https://meinianda.top/v1beta/models/{model}:generateContent?key={API_KEY}`，支持 `gemini-3.1-flash-image` 和 `gemini-3-pro-image`，供画廊生成和参考图编辑。
- 语言配置固定使用 `Responses API (/v1/responses)` 和 `gpt-5.6-sol`，供 Agent 理解请求和调用工具。

用户在设置页维护三项配置中的 API Key。应用启动、导入数据和浏览器持久化恢复时都会重新锁定服务地址、服务商和接口类型；画廊和画布可选择上述 GPT Image 与 Gemini 型号，保存后保留所选模型，旧的自定义配置不会重新出现。

首次打开应用或检测到三项配置都没有 API Key 时，会自动打开 API 配置页；配置任意一个密钥后不再自动弹出。顶栏的太阳/月亮按钮可直接切换全局浅色与深色页面，并同步画廊、全局 Agent 和无限画布。

画廊参数按模型适配：

- 新建生图默认使用 `1024x1024`、数量 `1`。在 GPT 和 Gemini 之间切换时应用对应基础尺寸并将数量重置为 `1`；同类模型之间切换保留尺寸和数量。
- `gpt-image-2`：尺寸、质量、输出格式、背景、压缩率、审核和数量。
- `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`：质量扩展为 `auto`（默认）、`low`、`medium`、`high`、`xhigh`、`max`。切回 GPT Image 2 时将 `xhigh/max` 降为 `high`。
- 三个 GPT Image 模型共用现有尺寸校验：边长不超过 3840、为 16 的倍数、长短边比不超过 3:1，总像素为 655,360—8,294,400。支持横向 `3840x2160` 和纵向 `2160x3840`。
- 两个 2.5 模型支持 `background=auto/opaque/transparent`。原生透明 PNG 选择 `transparent` 与 PNG 即可，不需要“透明输出增强”；WebP 也支持透明，JPEG 自动设为不透明背景。
- `gemini-3.1-flash-image`：在尺寸弹窗中选择宽高比与 `512px/1K/2K/4K` 分辨率，并支持 PNG/JPEG、`minimal/high` 思考级别和数量。
- `gemini-3-pro-image`：在尺寸弹窗中选择宽高比与 `1K/2K/4K` 分辨率，并支持 PNG/JPEG 和数量。

Gemini 的分辨率和宽高比通过 `generationConfig.imageConfig` 发送，思考级别通过 Flash 模型的 `thinkingConfig` 发送。Gemini 数量大于 1 时由应用并发提交多个独立 `generateContent` 请求。服务端返回图片后，应用会按用户选择将真实像素转换为 PNG 或 JPEG，避免只修改 MIME 文本。

Gemini `generateContent` API 不接收遮罩参数，使用参考图进行编辑时需移除遮罩。画廊参数控件按当前值使用内容宽度，下拉菜单独立容纳完整候选项；输入栏会在 GPT Image 2、Gemini Flash 和 Gemini Pro 之间按参数数量平滑调整整体宽度。

Vercel 部署不需要配置默认 API 地址环境变量。构建命令为 `npm run build`，静态产物目录为 `dist`。
