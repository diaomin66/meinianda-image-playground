# GPT Image Playground

一个浏览器端的图像生成与 Agent 工作台。配置和任务数据仅保存在当前浏览器。

## 固定 API 配置

- 生图配置：固定服务地址 `https://meinianda.top/v1`，固定使用 `Images API (/v1/images)` 和 `gpt-image-2`。
- 语言配置：固定服务地址 `https://meinianda.top/v1`，固定使用 `Responses API (/v1/responses)` 和 `gpt-5.6-sol`。
- 两项配置仅允许填写各自的 API Key；地址、模型、服务商和接口类型不可修改。
- 画廊使用生图配置；Agent 使用语言配置处理对话，并使用生图配置创建图片。

## Vercel 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdiaomin66%2Fgpt-image-playground-fixed&project-name=gpt-image-playground&repository-name=gpt-image-playground-fixed)

点击按钮导入仓库即可部署。无需设置 API 地址环境变量；用户在页面设置中填写 API Key 后即可使用。

## 本地开发

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run build
```

## 许可

MIT
