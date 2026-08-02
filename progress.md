## 2026-08-02 - Task: 固定 API 配置并移除跳转入口

### What was done

- 将应用配置收敛为固定的生图与语言两项配置，地址固定为 `https://meinianda.top/v1`，仅保留各自的 API Key 输入。
- 生图固定使用 Images API，语言固定使用 Responses API；画廊和 Agent 分别使用对应的固定配置。
- 删除关于页、版本跳转、赞助/反馈跳转和 Markdown 链接跳转，所有原链接内容改为静态展示。
- 将 Vercel 配置改为直接安装依赖、构建并发布 `dist` 静态产物，并更新部署说明。

### Testing

- `npm run build`：通过。
- `npm test`：31 个测试文件、402 项测试全部通过。
- 源码锚点扫描：`rg -n -i "<a\\b|href=" src` 无匹配。
- 构建产物跳转地址扫描：无原项目 GitHub、赞助或反馈地址。
- Vercel 配置字段已通过官方 schema 校验。

### Notes

- `README.md`：改为固定配置和 Vercel 一键部署说明。
- `docs/fixed-configuration.md`：新增固定配置行为说明。
- `src/lib/fixedApiProfiles.ts`：新增两项固定配置及持久化恢复锁定逻辑。
- `src/lib/fixedApiProfiles.test.ts`：新增固定配置锁定与密钥迁移测试。
- `src/store.ts`：在默认设置、设置提交和持久化恢复时强制使用固定配置。
- `src/store.test.ts`：更新配置导入与临时复用测试以覆盖固定配置规则。
- `src/App.tsx`：移除 URL 参数和远程配置导入入口。
- `src/components/Header.tsx`：标题与更新提示改为不可跳转展示。
- `src/components/HelpModal.tsx`：移除底部项目跳转。
- `src/components/MarkdownRenderer.tsx`：Markdown 链接改为静态文本。
- `src/components/SettingsModal.tsx`：移除关于页并接入固定配置页。
- `src/components/SupportPromptModal.tsx`：移除赞助和反馈跳转。
- `src/components/settings/AgentSettingsTab.tsx`：展示固定 Agent 配置，移除切换入口。
- `src/components/settings/FixedApiSettingsTab.tsx`：新增仅 API Key 可编辑的两项配置界面。
- `src/hooks/useVersionCheck.ts`：删除不再使用的版本跳转检查。
- `vercel.json`：启用 Vite 静态构建部署配置。
- 回滚：推送后执行 `git revert <本次提交哈希>`。

## 2026-08-02 - Task: 增加 Gemini 生图并更名为 Meinianda Image Playground

### What was done

- 新增固定 Gemini 生图配置，使用 `https://meinianda.top/v1beta/interactions`，支持 `gemini-3.1-flash-image` 与 `gemini-3-pro-image`，仅开放独立 API Key。
- 画廊新增三模型选择并自动路由 GPT/Gemini 配置；GPT 与两种 Gemini 模型分别展示和发送官方支持的参数。
- Gemini 参考图输入、输出解析、多图并发与部分成功处理已接入；遮罩参数在提交前明确拦截。
- 项目品牌、PWA、部署配置、发布工作流、Docker 镜像名和 GitHub/Vercel 部署入口统一更名。

### Testing

- `npm run build`：通过。
- `npm test -- --run src/lib/geminiImageApi.test.ts src/lib/fixedApiProfiles.test.ts src/lib/apiProfiles.test.ts src/lib/devProxy.test.ts src/store.test.ts`：5 个测试文件、155 项测试通过。
- Gemini 请求验证：确认使用 `/v1beta/interactions`、`x-goog-api-key`、模型专属分辨率/宽高比/思考级别及并发数量处理。
- 静态扫描：源码未新增可跳转锚点或 `href=`；未残留 Gemini preview 模型名或错误的 `/v1beta/v1` 路径。

### Notes

- `.github/workflows/docker.yml`：Docker 镜像名改为 Meinianda Image Playground。
- `.github/workflows/vercel-tag-deploy.yml`：移除原上游 Release 门槛，版本变化即可触发部署钩子。
- `AGENTS.md`：更新项目名称。
- `README.md`：更新固定配置、三模型、Vercel 与本地部署说明。
- `RELEASE.md`：新增 `v0.8.0` 发布说明。
- `docs/fixed-configuration.md`：记录 Gemini 固定配置、模型参数差异和遮罩限制。
- `index.html`：更新页面与 PWA 标题。
- `package.json`、`package-lock.json`：包名改为 `meinianda-image-playground`，版本升级到 `0.8.0`。
- `public/manifest.webmanifest`、`public/pwa-icon.svg`、`public/sw.js`：更新 PWA 品牌、图标与缓存版本。
- `scripts/mock-image-api.mjs`、`wrangler.jsonc`：更新本地模拟服务和 Cloudflare 项目名。
- `src/components/DetailModal.tsx`、`src/components/TaskCard.tsx`：按供应商展示任务模型与参数。
- `src/components/Header.tsx`、`src/components/HelpModal.tsx`：更新可见品牌名称。
- `src/components/InputBar.tsx`、`src/components/input/inputParamsPanel.tsx`：新增模型选择与 GPT/Gemini 差异化参数面板。
- `src/components/settings/FixedApiSettingsTab.tsx`：新增 Gemini API Key 固定配置卡片。
- `src/lib/api.ts`、`src/lib/geminiImageApi.ts`：新增 Gemini 请求路由、请求构造、响应解析与并发处理。
- `src/lib/apiProfiles.ts`、`src/lib/fixedApiProfiles.ts`、`src/lib/imageModels.ts`：新增 Gemini 服务商、固定配置和模型能力常量。
- `src/lib/devProxy.ts`：支持保留 `v1beta` API 版本路径。
- `src/lib/imageApiShared.ts`、`src/lib/openaiCompatibleImageApi.ts`：接入 GPT Image 2 原生背景参数。
- `src/lib/paramCompatibility.ts`、`src/lib/persistedState.ts`、`src/store.ts`、`src/types.ts`：新增模型参数、持久化兼容、任务路由与输入限制。
- `src/lib/apiProfiles.test.ts`、`src/lib/devProxy.test.ts`、`src/lib/fixedApiProfiles.test.ts`、`src/lib/geminiImageApi.test.ts`、`src/store.test.ts`：覆盖新配置、路径、请求与迁移行为。
- 回滚：推送后执行 `git revert <本次提交哈希>`；GitHub 仓库重命名可用 `gh repo rename gpt-image-playground-fixed --repo diaomin66/meinianda-image-playground --yes` 回滚名称。

## 2026-08-02 - Task: 发布 GitHub 并完成本地生产部署

### What was done

- 将功能提交 `d8f8942` 推送到 GitHub `main`，并将公开仓库重命名为 `diaomin66/meinianda-image-playground`。
- 更新本地 `deployment` remote 指向重命名后的仓库，并确认远端 `main` 可读取。
- 启动 Vite 生产预览，本地服务固定监听 `http://127.0.0.1:4173/`。

### Testing

- 完整 `npm test`：32 个测试文件、407 项测试全部通过。
- 完整 `npm run build`：通过。
- GitHub 仓库主页：HTTP 200，默认分支为 `main`，页面可识别新品牌名称。
- GitHub Actions：Vercel 发布工作流运行成功；仓库未设置 `VERCEL_DEPLOY_HOOK`，因此明确跳过云端 Vercel 触发。
- 本地生产预览：HTTP 200，页面标题包含 `Meinianda Image Playground`，监听进程 PID 为 `66448`。

### Notes

- `progress.md`：追加 GitHub 发布、仓库重命名、云端部署条件和本地部署验证记录。
- 回滚代码：执行 `git revert d8f8942` 后推送 `main`。
- 回滚仓库名称：执行 `gh repo rename gpt-image-playground-fixed --repo diaomin66/meinianda-image-playground --yes`。
- 停止本地服务：执行 `Stop-Process -Id 66448`。
