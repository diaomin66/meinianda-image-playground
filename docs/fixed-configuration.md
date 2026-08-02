# 固定配置说明

应用内置两项固定 API 配置，服务地址均为 `https://meinianda.top/v1`。

- 生图配置固定使用 `Images API (/v1/images)` 和 `gpt-image-2`，供画廊生成和编辑图片。
- 语言配置固定使用 `Responses API (/v1/responses)` 和 `gpt-5.6-sol`，供 Agent 理解请求和调用工具。

用户只能维护两项配置中的 API Key。应用启动、导入数据和浏览器持久化恢复时都会重新锁定服务地址、模型、服务商和接口类型；旧配置不会重新出现。

Vercel 部署不需要配置默认 API 地址环境变量。构建命令为 `npm run build`，静态产物目录为 `dist`。
