# 无限画布集成说明

## 范围

无限画布模块提取自 `basketikun/infinite-canvas` 的“我的画布”依赖闭包，来源版本为 `v0.12.1`、提交 `ea0414e88cffa6b522cc13c0613b3c8085983a53`。未接入生图工作台、视频创作台、提示词库、我的资产或配置等独立顶层页面。

复制源码保留在 `src/infiniteCanvas/`，并保留原项目的 AGPL-3.0 `LICENSE`、`NOTICE.md`、`CHANGELOG.md` 和 `VERSION`。

## 宿主接入

- 无限画布与画廊、Agent 同级，由主项目 `AppMode` 切换。
- 无限画布是默认界面，复用主项目固定 Header。
- 桌面端三种模式共用同一位置的导航容器；切换时仅让选中胶囊在导航项之间平滑滑动，不对页面内容做淡入淡出或 View Transition。
- 三个模式标签在选中态和未选中态都强制单行显示；桌面三等分单元保留足够文字宽度，避免“无限画布”被拆成两行。
- 画布内容通过 `src/components/InfiniteCanvasWorkspace.tsx` 直接渲染 React 源码，不使用 iframe 或独立子站。
- 画布路由使用模块内 `MemoryRouter`，不接管主项目浏览器地址。
- Canvas Agent 使用复制的上游 AgentPanel 依赖闭包，只恢复原面板入口，不替换为主项目 Agent 业务逻辑。
- 画布新建生图和配置节点默认使用 `1024x1024`、数量 `1`；节点仍可单独覆盖参数。

## 视觉边界

- 画布使用独立 Tailwind 3 配置，utility 和 reset 仅在 `.infinite-canvas-module` 内生效。
- 上游 `stone-*` 映射为 Zinc；画布、节点、工具栏、Ant Design 浮层统一使用主项目 Zinc/Blue、字体、边框、圆角、阴影和浅色/深色规则。
- 不修改组件顺序、DOM 布局、画布业务逻辑或节点功能。
- 所有弹窗、抽屉、确认框和手动 portal 使用 viewport 级画布 overlay root，避免被宿主裁剪或退回 Ant 默认样式。

## 本地运行

```powershell
npm install
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

访问 `http://127.0.0.1:4173/`。验收时至少检查画布列表、新建画布、完整编辑器、左右面板、底部工具栏、配置弹窗、快捷键弹窗、Canvas Agent、浅色/深色切换和 390px 移动端布局。

## 窄屏嵌入规则

- `640px` 及以下宽度默认收起左侧画布面板，避免面板覆盖整个可用画布；用户仍可通过顶部面板按钮打开抽屉。
- 窄屏侧栏和 Canvas Agent 面板均从主导航栏下方开始，保留顶部标题与操作按钮的可访问性。
- 窄屏顶部隐藏非核心状态和版本操作，仅保留画布菜单、面板切换与 Agent 入口；桌面端完整保留原有操作。

## Viewport 布局规则

- `1180px` 及以上时，宿主导航、画布项目控件和全局操作共用同一 Header 行；工作区占满该行以下的剩余视口。
- 低于 `1180px` 时保留画布内部顶栏，避免宿主操作与画布控件重叠。
- `640px` 及以下时左侧抽屉默认关闭；缩放控件独占一行，位于可横向滚动的创建工具栏上方。

## Canvas Agent 可见性与生命周期

- Agent 新增节点或触发节点生成后，如果本次操作没有显式设置 viewport，画布会在 `260ms` 内平滑聚焦新增节点或生成目标，避免节点落在当前视口外却提示“已完成”。
- 生成任务完成后会再次聚焦实际新增的结果节点；空媒体节点写回自身时则聚焦该目标节点。
- 空操作或格式无效的操作会先作为结构化失败结果回传模型，让模型自动修正；连续无法修正时才向用户返回准确错误，不会假成功。
- 切换到画廊或全局 Agent 时，Canvas Agent 面板立即关闭并移除 overlay；重新进入无限画布时保持关闭。
- 面板关闭或模块切换不会中止仍在运行的 Canvas Agent 会话；不同历史会话继续使用各自的请求控制器并行运行。

## Canvas Agent skill 与工具契约

- `src/infiniteCanvas/lib/agent/canvas-skill.md` 保存并注入原项目的 Canvas skill；直连 Responses Agent 每轮都能看到该工作流，而不是只看到一个泛化的底层操作工具。
- Canvas Agent 优先使用 `previous_response_id` 续接同一轮工具调用；如果兼容服务提示该字段不受支持或仅支持 Responses WebSocket v2，则自动改为成对重放 `function_call` 与 `function_call_output`，不向用户暴露协议兼容错误。
- 直连 Agent 暴露与该 skill 对齐的 `canvas_get_*`、`canvas_create_*`、`canvas_generate_*`、更新、移动、连接、选择、视口和 `canvas_apply_ops` 工具，共覆盖当前“我的画布”模块支持的画布操作。
- 用户要求生图时优先调用 `canvas_generate_image`。该工具沿用原项目流程创建提示词节点、图片配置节点和连线，随后对配置节点执行 `run_generation`；`add_node` 只创建节点，不能代表生成成功。
- 如果模型在明确的生图请求中仍只返回 `add_node`，工具层会将其作为可修正错误回传，要求模型改用 `canvas_generate_image` 或补充指向真实节点的 `run_generation`。
- `run_generation` 执行前校验生成器和目标节点。工具结果以 `started` 表示异步生成已启动，模型不得在媒体结果尚未返回时声称“已经生成完成”。

## 生图参数弹层

- 配置节点和节点提示词面板共用同一套生图参数组件；参数总览与尺寸选择使用单一 `closed/settings/size` 状态机，不再由两个布尔状态互相关闭。
- 从“生图参数”进入尺寸选择、确认或取消后会稳定返回原参数页；模型、数量、质量、格式、背景等控件的修改继续写回当前节点。
- Ant Design 参数弹窗和尺寸选择器都建立明确的鼠标、指针、滚轮事件边界；浮层交互不会继续传给节点拖拽、画布平移或画布缩放。
- 尺寸选择器挂载到统一 overlay root，并处于参数弹窗之上的独立层级，避免退出动画期间被旧弹窗遮挡。

## 生成图片存储容错

- 图片接口成功后，结果优先写入 IndexedDB；如果浏览器返回 `QuotaExceededError` 或 Firefox 的 transaction quota 错误，则自动改存 Cache Storage。
- 如果 IndexedDB 与 Cache Storage 都无法写入，图片仍以当前页面内存 URL 显示并保持生成成功状态，不再把本地存储失败误报为“生图失败”。
- 内存回退会显示中文警告，提醒用户及时下载或清理旧画布素材；该级回退无法保证刷新后恢复图片。
- 图片读取、删除和未使用文件清理同时覆盖 IndexedDB 与 Cache Storage，避免回退缓存成为新的孤立占用。

## Theme synchronization

- General settings persist a system, light, or dark preference shared by the Gallery, global Agent, and infinite canvas.
- The resolved host theme is applied before React mounts and is propagated to the canvas theme store and its Ant Design provider.

## Canvas Agent 多窗口与历史管理

- Canvas Agent 继续复用原有直连请求、Canvas skill 和画布操作协议；多窗口只扩展会话展示层，不重写请求逻辑。
- 每个已打开历史会话对应一个独立 Agent 卡片，拥有自己的输入草稿、附件、运行状态、停止按钮和请求控制器，可同时运行。
- 桌面端根据可用宽高采用单列滚动或宽屏双列网格；低于 `900px` 时只展示当前聚焦会话，其他窗口继续保留运行状态并可从历史列表切换。
- 历史列表支持搜索、打开、删除和运行中状态提示，并通过统一 overlay root 渲染，避免被短窗口或画布容器裁剪。
- 从具体画布返回“我的画布”、切换到画廊/全局 Agent 或卸载无限画布模块时，Canvas Agent UI 自动执行原有收起动画并解除项目绑定。
- 消息区域复用全局 Markdown 渲染器，并增加消息卡片、生成中指示、工具操作卡、错误卡、自动滚动、回到底部和复制回复。
- Canvas Agent 图片附件不再限制张数或前端总大小；所选图片会全部加入，最终请求容量由当前模型和 API 服务端决定。

## 全局 Agent 历史恢复

- 当保存的活动会话 ID 已失效时，启动恢复、进入 Agent 模式和 Agent 工作区兜底逻辑统一选择最近更新的历史会话，不再误建空白对话。
- 删除当前全局 Agent 会话后会自动切换到最近更新的剩余历史，并恢复该会话的输入草稿。
- 历史弹窗只有在成功切换到 Agent 模式后才应用会话选择，避免配置校验阻止切换时出现“弹窗已关闭但页面未切换”的假状态。
- 顶栏历史弹层保留横向裁剪但允许纵向溢出，避免弹层被 Header 高度裁掉而出现点击无反应。

## 画布顶栏精简

- 无限画布顶栏不再显示上游版本更新入口和 GitHub 跳转。
- 节点插件、快捷键和其他画布操作保持不变。
