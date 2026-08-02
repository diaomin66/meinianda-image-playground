## v0.8.1（2026-08-02）

### 修复
- Gemini 生图改用 `/v1beta/models/{model}:generateContent?key={API_KEY}`，尺寸与比例通过 `generationConfig.imageConfig` 生效。
- Gemini 尺寸设置复用 GPT 弹出式选择器，并按 Flash/Pro 模型限制可选分辨率和宽高比；PNG/JPEG 输出由应用完成真实像素格式转换。
- 画廊参数按当前内容精确自适应宽度，完整展示模型与参数值，并在切换 GPT/Gemini 时平滑调整输入栏长度。

## v0.8.0（2026-08-02）

### 新功能
- 项目更名为 Meinianda Image Playground。
- 新增 Gemini `v1beta/interactions` 生图配置，支持 `gemini-3.1-flash-image` 和 `gemini-3-pro-image`。
- 画廊新增三模型选择，并按 GPT Image 2、Gemini Flash、Gemini Pro 的官方能力分别展示参数。
- Gemini 多图数量通过并发独立请求实现，参考图上限适配为 14 张。

### 部署
- Vercel 发布工作流不再依赖原上游仓库的 Release。
- Vercel、Cloudflare Workers、Docker 和 PWA 品牌名称同步更新。

## v0.7.3（2026-08-01）

### 修复
- 修复 Service Worker 缓存同源动态 GET 请求的问题：仅缓存应用外壳及构建静态资源，避免异步生图轮询接口持续返回首次缓存的处理中状态，并在更新后自动清理旧缓存 (#127)。
