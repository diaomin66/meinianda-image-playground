# Meinianda Image Playground

一个浏览器端的 GPT Image、Gemini Image 与 Agent 工作台。配置和任务数据仅保存在当前浏览器。

## 固定 API 配置

- 生图配置：固定服务地址 `https://meinianda.top/v1`，固定使用 `Images API (/v1/images)` 和 `gpt-image-2`。
- Gemini 生图配置：固定服务地址 `https://meinianda.top/v1beta`，固定使用 `generateContent API (/v1beta/models/{model}:generateContent)`；画廊可选 `gemini-3.1-flash-image` 和 `gemini-3-pro-image`。
- 语言配置：固定服务地址 `https://meinianda.top/v1`，固定使用 `Responses API (/v1/responses)` 和 `gpt-5.6-sol`。
- 三项配置仅允许填写各自的 API Key；地址、服务商和接口类型不可修改。
- 画廊根据模型选择自动切换 GPT/Gemini 生图配置；Agent 继续使用语言配置处理对话，并使用 GPT 生图配置创建图片。
- 参数控件按当前值自动调整宽度；输入栏会根据 GPT、Gemini Flash 和 Gemini Pro 的参数数量平滑拉长或缩短。

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

MIT
