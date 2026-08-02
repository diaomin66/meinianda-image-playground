# 固定配置说明

应用内置三项固定 API 配置。

- 生图配置固定使用 `Images API (/v1/images)` 和 `gpt-image-2`，供画廊生成和编辑图片。
- Gemini 生图配置固定使用 `https://meinianda.top/v1beta/interactions`，支持 `gemini-3.1-flash-image` 和 `gemini-3-pro-image`，供画廊生成和参考图编辑。
- 语言配置固定使用 `Responses API (/v1/responses)` 和 `gpt-5.6-sol`，供 Agent 理解请求和调用工具。

用户只能维护三项配置中的 API Key。应用启动、导入数据和浏览器持久化恢复时都会重新锁定服务地址、服务商和接口类型；Gemini 模型只允许在画廊中选择上述两个固定型号，旧配置不会重新出现。

画廊参数按模型适配：

- `gpt-image-2`：尺寸、质量、输出格式、背景、压缩率、审核和数量。
- `gemini-3.1-flash-image`：宽高比、`512px/1K/2K/4K` 分辨率、PNG/JPEG、`minimal/high` 思考级别和数量。
- `gemini-3-pro-image`：宽高比、`1K/2K/4K` 分辨率、PNG/JPEG 和数量。

Gemini 数量大于 1 时由应用并发提交多个独立 Interactions 请求。Gemini 官方 Interactions API 不接收遮罩参数，使用参考图进行编辑时需移除遮罩。

Vercel 部署不需要配置默认 API 地址环境变量。构建命令为 `npm run build`，静态产物目录为 `dist`。
