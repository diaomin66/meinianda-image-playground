## v0.9.0-beta.1（2026-09-13，测试版）

### 新功能
- 新增「人物（beta）」：自建人物、独立头像、多张参考图、人格聊天、相册与历史对话批量删除。
- 接入 Gemini 原生流式语言接口，支持函数调用、提示词副脑、多图并发优化与后台生图。
- 新增可筛选和导出的对话日志，以及聊天时按日生成穿搭与生活日程。

### 修复与体验
- 修复 Gemini 流式尾片、图片响应识别、画幅参数、长请求转发与重复图片问题。
- 统一蓝色强调色、圆角菜单与抽屉、进退场动画和浅色图片查看背景。
- 人物资料与图片纳入备份；同步应用版本和 PWA 缓存版本，beta Docker 镜像使用版本号与 `beta` 标签。
- 修复生活日程首次生成后当轮未生效、日程请求失败阻断聊天，以及批量删除部分选择状态。

完整范围、使用限制和发布验证见 [0.9.0-beta.1 更新说明](docs/release-0.9.0-beta.1.md)。

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
