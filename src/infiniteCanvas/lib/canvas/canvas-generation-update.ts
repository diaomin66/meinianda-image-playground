import { useCanvasStore } from "@canvas/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@canvas/types/canvas";
import { getDeletedGenerationTargets } from "./canvas-generation-requests";

export function createGenerationNodeUpdater(projectId: string, signal: AbortSignal) {
    return (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => {
        if (signal.aborted) return;
        const state = useCanvasStore.getState();
        const project = state.projects.find((item) => item.id === projectId);
        if (!project) return;
        const deleted = getDeletedGenerationTargets(signal);
        const previous = new Map(project.nodes.map((node) => [node.id, node]));
        const nodes = update(project.nodes).flatMap((node) => {
            if (!deleted.has(node.id)) return [node];
            const current = previous.get(node.id);
            return current ? [current] : [];
        });
        state.updateProject(projectId, { nodes });
    };
}
