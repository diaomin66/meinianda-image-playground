import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Download, Home, Images, Menu, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import { Button, Dropdown, Modal, Tooltip } from "antd";
import { getCanvasOverlayHost } from "@canvas/lib/overlay-host";

import { UserStatusActions } from "@canvas/components/layout/user-status-actions";
import { canvasThemes } from "@canvas/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@canvas/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@canvas/stores/use-theme-store";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    useLayoutEffect(() => {
        const media = window.matchMedia("(min-width: 1180px)");
        const sync = () => setHeaderHost(media.matches ? document.getElementById("canvas-header-slot") : null);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    const topBar = (
        <div className={headerHost ? "canvas-header-topbar pointer-events-none flex h-full min-w-0 flex-1 items-center justify-between gap-2" : "canvas-workspace-top-bar pointer-events-none absolute left-0 right-0 top-0 z-[70] flex h-16 items-center justify-between pl-1 pr-4"}>
                <div className="pointer-events-auto flex min-w-0 items-center gap-2">
                    <Tooltip title={sidePanelOpen ? "收起面板" : "展开面板"}>
                        <button
                            type="button"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? "收起面板" : "展开面板"}
                            className="grid size-7 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: theme.node.text }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入资产", onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: "导出当前画布", onClick: onExportProject },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-7 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-4" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                    <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} />
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5">
                    <div className="hidden sm:block">
                        <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                    </div>
                    <span className="hidden h-6 w-px sm:block" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(24,24,27,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>
                </div>
        </div>
    );

    return (
        <>
            {headerHost ? createPortal(topBar, headerHost) : topBar}
            <Modal getContainer={getCanvasOverlayHost} title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut theme={theme} keys={["拖动画布"]} value="平移视图" />
                    <Shortcut theme={theme} keys={["滚轮"]} value="缩放画布" />
                    <Shortcut theme={theme} keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut theme={theme} keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut theme={theme} keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut theme={theme} keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut theme={theme} keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut theme={theme} keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut theme={theme} keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut theme={theme} keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut theme={theme} keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut theme={theme} keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut theme={theme} keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? (status.activity && status.activity !== "就绪" ? `Agent ${status.activity}` : "Agent 已就绪") : "Agent 未配置";
    const dotColor = status.connected ? theme.node.activeStroke : theme.node.muted;
    return (
        <button type="button" className="hidden h-8 items-center gap-1.5 text-xs transition hover:opacity-75 sm:flex" style={{ color: dotColor }} onClick={onClick} title="打开画布 Agent 面板">
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[140px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ theme, keys, value }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel, color: theme.node.text }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
