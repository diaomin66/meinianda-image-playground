import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@canvas/lib/localforage-storage";
import { cancelCanvasGenerationRequests, getCanvasGenerationRequests, getDeletedGenerationTargets } from "@canvas/lib/canvas/canvas-generation-requests";
import type { CanvasBackgroundMode } from "@canvas/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@canvas/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let pendingSave: StorageValue<CanvasStore> | null = null;
let saving: Promise<void> | null = null;

export const useCanvasSaveStore = create<{ status: "saved" | "saving" | "error"; error: string | null }>(() => ({ status: "saved", error: null }));

export async function flushCanvasSave(): Promise<void> {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (saving) return saving;
    saving = (async () => {
        while (pendingSave) {
            const value = pendingSave;
            useCanvasSaveStore.setState({ status: "saving", error: null });
            try {
                await localForageStorage.setItem(CANVAS_STORE_KEY, JSON.stringify(value));
            } catch (error) {
                console.error("画布保存失败", error);
                useCanvasSaveStore.setState({ status: "error", error: error instanceof Error ? error.message : "存储不可用" });
                throw error;
            }
            if (pendingSave === value) pendingSave = null;
        }
        useCanvasSaveStore.setState({ status: "saved", error: null });
    })().finally(() => { saving = null; });
    return saving;
}

if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void flushCanvasSave().catch(() => {});
    });
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        pendingSave = value;
        useCanvasSaveStore.setState({ status: "saving", error: null });
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void flushCanvasSave().catch(() => {});
        }, 400);
    },
    removeItem: async (name) => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        pendingSave = null;
        queuedPersistState = null;
        await saving?.catch(() => {});
        await localForageStorage.removeItem(name);
    },
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    ids.forEach(cancelCanvasGenerationRequests);
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) => {
                if (patch.nodes) {
                    const ids = new Set(patch.nodes.map((node) => node.id));
                    const requests = getCanvasGenerationRequests(id);
                    requests.forEach((request, key) => {
                        if (ids.has(request.targetNodeId) && ids.has(request.originNodeId)) return;
                        // 同批请求共享控制器，单个结果节点删除只移除其写回资格。
                        requests.delete(key);
                        if (!ids.has(request.targetNodeId)) getDeletedGenerationTargets(request.controller.signal).add(request.targetNodeId);
                        if (!ids.has(request.originNodeId)) request.controller.abort();
                    });
                }
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                }));
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
