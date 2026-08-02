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
