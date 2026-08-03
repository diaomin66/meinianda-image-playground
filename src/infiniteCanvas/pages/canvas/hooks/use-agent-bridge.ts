import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { useAgentStore } from "@canvas/stores/use-agent-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@canvas/lib/canvas/canvas-agent-ops";
import type { CanvasNodeGenerationMode } from "@canvas/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@canvas/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

type ViewportSize = { width: number; height: number };

export function isExecutableCanvasAgentOp(op: unknown): op is CanvasAgentOp {
    if (!op || typeof op !== "object" || !("type" in op)) return false;
    const value = op as Record<string, unknown>;
    if (value.type === "add_node") return true;
    if (value.type === "update_node") return typeof value.id === "string" && Boolean(value.id) && (typeof value.patch === "object" || typeof value.metadata === "object");
    if (value.type === "delete_node") return typeof value.id === "string" || Array.isArray(value.ids) || typeof value.nodeType === "string";
    if (value.type === "delete_connections") return value.all === true || typeof value.id === "string" || Array.isArray(value.ids);
    if (value.type === "connect_nodes") return typeof value.fromNodeId === "string" && Boolean(value.fromNodeId) && typeof value.toNodeId === "string" && Boolean(value.toNodeId);
    if (value.type === "set_viewport") {
        const viewport = value.viewport as Partial<ViewportTransform> | undefined;
        return Boolean(viewport && Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.k));
    }
    if (value.type === "select_nodes") return Array.isArray(value.ids) && value.ids.some((id) => typeof id === "string" && Boolean(id));
    return value.type === "run_generation" && typeof value.nodeId === "string" && Boolean(value.nodeId);
}

export function getAgentFocusViewport(nodes: CanvasNodeData[], size: ViewportSize): ViewportTransform | null {
    if (!nodes.length || size.width <= 0 || size.height <= 0) return null;
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + Math.max(node.width, 1)));
    const maxY = Math.max(...nodes.map((node) => node.position.y + Math.max(node.height, 1)));
    const padding = 96;
    const targetWidth = Math.max(1, maxX - minX);
    const targetHeight = Math.max(1, maxY - minY);
    const k = Math.min(1.35, Math.max(0.2, Math.min((size.width - padding * 2) / targetWidth, (size.height - padding * 2) / targetHeight)));
    return {
        x: size.width / 2 - (minX + targetWidth / 2) * k,
        y: size.height / 2 - (minY + targetHeight / 2) * k,
        k,
    };
}

/**
 * 画布与 Agent 的桥接：把当前画布快照与 apply/undo 能力发布到 agent store，
 * 供画布 Agent 面板读取。除 applyAgentOps（配置节点插件宿主会用到）外均为内部实现。
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const focusFrameRef = useRef<number | null>(null);
    const projectTitle = title || "未命名画布";

    const focusNodes = useCallback((targetNodes: CanvasNodeData[]) => {
        const element = document.querySelector<HTMLElement>(".canvas-workspace-surface");
        const rect = element?.getBoundingClientRect();
        const size = { width: rect?.width || window.innerWidth, height: rect?.height || window.innerHeight };
        const target = getAgentFocusViewport(targetNodes, size);
        if (!target) return null;
        if (focusFrameRef.current) cancelAnimationFrame(focusFrameRef.current);
        const start = viewportRef.current;
        const startedAt = performance.now();
        const animate = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / 260);
            const eased = 1 - Math.pow(1 - progress, 3);
            const next = {
                x: start.x + (target.x - start.x) * eased,
                y: start.y + (target.y - start.y) * eased,
                k: start.k + (target.k - start.k) * eased,
            };
            viewportRef.current = next;
            setViewport(next);
            if (progress < 1) focusFrameRef.current = requestAnimationFrame(animate);
            else focusFrameRef.current = null;
        };
        focusFrameRef.current = requestAnimationFrame(animate);
        return target;
    }, [setViewport, viewportRef]);

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter(isExecutableCanvasAgentOp) : [];
            if (!safeOps.length) throw new Error("Agent 未返回有效画布操作。");
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            const generateNode = generateNodeRef.current;
            if (generationOps.length && !generateNode) throw new Error("画布生成器尚未就绪，请稍后重试。");
            const missingTarget = generationOps.find((op) => !next.nodes.some((node) => node.id === op.nodeId));
            if (missingTarget) throw new Error(`找不到生成目标节点：${missingTarget.nodeId}`);
            const hasExplicitViewport = safeOps.some((op) => op.type === "set_viewport");
            const beforeNodeIds = new Set(before.nodes.map((node) => node.id));
            const focusNodeIds = new Set([
                ...next.nodes.filter((node) => !beforeNodeIds.has(node.id)).map((node) => node.id),
                ...generationOps.map((op) => op.nodeId),
            ]);
            const focusTargets = hasExplicitViewport ? [] : next.nodes.filter((node) => focusNodeIds.has(node.id));
            const focusedViewport = focusTargets.length ? focusNodes(focusTargets) : null;
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            if (!focusedViewport) viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            if (!focusedViewport) setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length && generateNode) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const existingNodeIds = new Set(nodesRef.current.map((node) => node.id));
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNode(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt)
                            .then(() => {
                                requestAnimationFrame(() => {
                                    const createdNodes = nodesRef.current.filter((node) => !existingNodeIds.has(node.id));
                                    const completedTarget = nodesRef.current.find((node) => node.id === op.nodeId);
                                    focusNodes(createdNodes.length ? createdNodes : completedTarget ? [completedTarget] : []);
                                });
                            })
                            .catch((error) => console.error("Canvas Agent generation failed", error));
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle, viewport: focusedViewport || next.viewport };
        },
        [focusNodes, projectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle };
    }, [agentUndoSnapshot, projectTitle, projectId]);

    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps]);

    useEffect(() => () => {
        if (focusFrameRef.current) cancelAnimationFrame(focusFrameRef.current);
    }, []);

    return { applyAgentOps };
}
