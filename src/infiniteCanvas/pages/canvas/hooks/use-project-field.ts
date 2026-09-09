import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useCanvasStore, type CanvasProject } from "@canvas/stores/canvas/use-canvas-store";

const EMPTY_ITEMS: never[] = [];

export function useProjectField<K extends "nodes" | "connections">(projectId: string, field: K) {
    const value = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.[field] || EMPTY_ITEMS as CanvasProject[K]);
    const setValue: Dispatch<SetStateAction<CanvasProject[K]>> = useCallback((next) => {
        const state = useCanvasStore.getState();
        const project = state.projects.find((item) => item.id === projectId);
        if (!project) return;
        const value = typeof next === "function" ? next(project[field]) : next;
        if (value !== project[field]) state.updateProject(projectId, { [field]: value });
    }, [projectId, field]);
    return [value, setValue] as const;
}
