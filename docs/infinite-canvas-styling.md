# 无限画布样式构建

无限画布使用独立的 Tailwind 3 配置，避免把画布的 utility、主题变量或 reset 扩散到画廊和 Agent。

- 配置文件：`tailwind.canvas.config.js`
- 样式入口：`src/infiniteCanvas/canvas.css`
- 作用域：`.infinite-canvas-module`
- 主题：模块根节点的 `dark` class

`canvas.css` 通过 `@config '../../tailwind.canvas.config.js'` 绑定独立配置，并且禁用了 Tailwind 全局 preflight，改为仅对模块内部生效的基础 reset。画布源码中的 `stone-*` class 映射为项目使用的 Zinc 调色板，字体和语义颜色使用项目既有 CSS 变量。

接入时以 `canvas.css` 替换旧的预编译 `upstream.css` import；不要把 `tailwind.canvas.config.js` 合并进根 Tailwind 配置，也不要在 `src/index.css` 引入画布 reset。

画布内的非语义性视觉 token 使用项目的 Zinc 中性色和主色蓝：保留红、橙、绿等状态含义色，以及遮罩/导出等图像处理数据颜色；不要为统一外观而修改这些功能性颜色。

画布界面不提供文档链接或独立全局配置入口；生成配置节点及其参数面板仍保留。视频和音频的新建、连接创建、双击创建与类型筛选入口隐藏，但既有节点、上传和服务能力不受影响。

画布绘制层、节点、工具栏和 Ant Design 控件分别由 `src/infiniteCanvas/lib/canvas-theme.ts`、`src/infiniteCanvas/lib/app-theme.ts` 与 `src/infiniteCanvas/integration.css` 提供颜色。三处必须同时保持为项目的 Zinc/Blue 映射，不能重新引入上游的 warm stone 或独立 slate 色值。

画布首次使用时读取宿主的 system/light/dark 偏好；主题切换由主项目顶栏太阳/月亮按钮或通用设置统一驱动，画廊、全局 Agent、无限画布和 Ant Design provider 同步更新，不再由画布单独监听系统主题。

所有 Ant Design `Modal`、`Drawer`、`modal.confirm` 以及手动 portal 都挂载到 `infinite-canvas-overlay-root`。这样浮层既不会被画布裁剪，也能继承画布模块的字体、主题变量和 scoped 样式。

左右面板使用宿主卡片语言，而不是上游贴边栏：

- 外侧保留 `12px` 间距，内容为完整圆角、全边框、柔和阴影的浮动卡片。
- 开合同时过渡宽度、透明度、水平位移和轻微缩放；关闭态宽度为 `0`，不保留 padding、拖拽手柄或不可见占位。
- 左侧搜索、筛选和标签控件至少 `36px` 高；右侧 Agent 的配置、历史会话、新建、删除按钮至少 `36px`，发送/停止按钮为 `40px`。
- 移动端卡片最大宽度扣除安全区与两侧留白，不产生页面横向滚动。

控件尺寸遵循同一层级的密度规则：Header 模式导航外框为 `42px`、内部按钮为 `32px`；普通图标操作按钮为 `36px`；主要提交/停止操作为 `40px`。模式标签的活动文字和普通文字均强制单行显示，桌面按钮使用不会挤压“无限画布”的内边距。模型选择与生图参数按钮使用等分网格、`40px` 高度、相同圆角和相同内边距，避免因文字长度改变按钮尺寸。
