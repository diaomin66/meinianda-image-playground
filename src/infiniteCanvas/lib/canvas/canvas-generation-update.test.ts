import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@canvas/lib/localforage-storage", () => ({ localForageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
import { useCanvasStore, flushCanvasSave, useCanvasSaveStore } from "@canvas/stores/canvas/use-canvas-store";
import { localForageStorage } from "@canvas/lib/localforage-storage";
import { getCanvasGenerationRequests } from "./canvas-generation-requests";
import { createGenerationNodeUpdater } from "./canvas-generation-update";
import { CanvasNodeType } from "@canvas/types/canvas";

describe("后台生成写回", () => {
    let id: string;
    beforeEach(() => {
        id = useCanvasStore.getState().createProject();
        useCanvasStore.getState().updateProject(id, { nodes: [{ id: "node", type: CanvasNodeType.Image, title: "结果", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { status: "loading" } }] });
    });
    afterEach(async () => { useCanvasStore.getState().deleteProjects([id]); await flushCanvasSave(); });

    it("没有挂载组件也会保存结果，并保留生成期间的位置编辑", () => {
        const update = createGenerationNodeUpdater(id, new AbortController().signal);
        const project = useCanvasStore.getState().openProject(id)!;
        useCanvasStore.getState().updateProject(id, { nodes: project.nodes.map((node) => ({ ...node, position: { x: 200, y: 300 } })) });
        update((nodes) => nodes.map((node) => ({ ...node, metadata: { content: "blob:done", status: "success" } })));
        expect(useCanvasStore.getState().openProject(id)?.nodes[0]).toMatchObject({ position: { x: 200, y: 300 }, metadata: { content: "blob:done", status: "success" } });
    });
    it("停止或被重试取代的请求不覆盖新结果，删除项目也不会复活", () => {
        const controller = new AbortController();
        getCanvasGenerationRequests(id).set("node", { targetNodeId: "node", originNodeId: "node", runningNodeId: "node", controller });
        const update = createGenerationNodeUpdater(id, controller.signal);
        controller.abort();
        update((nodes) => nodes.map((node) => ({ ...node, title: "old result" })));
        expect(useCanvasStore.getState().openProject(id)?.nodes[0].title).toBe("结果");
        useCanvasStore.getState().deleteProjects([id]);
        update((nodes) => nodes);
        expect(useCanvasStore.getState().openProject(id)).toBeNull();
    });

    it("批量生成中删除再撤销的节点不会接收旧请求结果", () => {
        const controller = new AbortController();
        const project = useCanvasStore.getState().openProject(id)!;
        const target = { ...project.nodes[0], id: "child" };
        useCanvasStore.getState().updateProject(id, { nodes: [...project.nodes, target] });
        getCanvasGenerationRequests(id).set("child", { targetNodeId: "child", originNodeId: "node", runningNodeId: "node", controller });
        const update = createGenerationNodeUpdater(id, controller.signal);
        useCanvasStore.getState().updateProject(id, { nodes: project.nodes });
        useCanvasStore.getState().updateProject(id, { nodes: [...project.nodes, target] });
        update((nodes) => nodes.map((node) => node.id === "child" ? { ...node, title: "stale" } : node));
        expect(controller.signal.aborted).toBe(false);
        expect(useCanvasStore.getState().openProject(id)?.nodes[1].title).toBe("结果");
    });

    it("保存失败保留待写内容，重试后状态恢复为已保存", async () => {
        vi.spyOn(console, "error").mockImplementationOnce(() => {});
        vi.mocked(localForageStorage.setItem).mockRejectedValueOnce(new Error("quota"));
        await expect(flushCanvasSave()).rejects.toThrow("quota");
        expect(useCanvasSaveStore.getState().status).toBe("error");
        await flushCanvasSave();
        expect(useCanvasSaveStore.getState().status).toBe("saved");
        const calls = vi.mocked(localForageStorage.setItem).mock.calls;
        expect(String(calls[calls.length - 1]?.[1])).toContain(id);
    });
});
