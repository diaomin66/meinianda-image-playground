import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredDirectAgentConversation } from "@canvas/services/agent-chat-storage";
const mocks = vi.hoisted(() => ({
    setImage: vi.fn(), deleteImages: vi.fn(), replaceProjects: vi.fn(), zip: new Map<string, Blob>(), readConversations: vi.fn(), saveConversations: vi.fn(),
    agent: { directConversationsLoaded: true, directConversationsLoading: false, directConversations: [] as StoredDirectAgentConversation[] },
}));
vi.mock("@canvas/lib/zip", () => ({ readZip: async () => mocks.zip }));
vi.mock("@canvas/services/image-storage", () => ({ getImageBlob: async () => null, setImageBlob: mocks.setImage, deleteStoredImages: mocks.deleteImages }));
vi.mock("@canvas/services/file-storage", () => ({ getMediaBlob: async () => null, setMediaBlob: vi.fn(), deleteStoredMedia: vi.fn() }));
vi.mock("@canvas/stores/canvas/use-canvas-store", () => ({ useCanvasStore: { getState: () => ({ projects: [], replaceProjects: mocks.replaceProjects }) }, flushCanvasSave: vi.fn() }));
vi.mock("@canvas/stores/use-agent-store", () => ({ useAgentStore: { getState: () => mocks.agent, setState: (patch: Partial<typeof mocks.agent>) => { mocks.agent = { ...mocks.agent, ...patch }; } } }));
vi.mock("@canvas/services/agent-chat-storage", () => ({ readDirectAgentConversations: mocks.readConversations, saveDirectAgentConversations: mocks.saveConversations }));
import { importCanvasArchive, validateCanvasImport } from "./canvas-import";

function backup() {
    return { app: "infinite-canvas", version: 3, projects: [{ project: {
        id: "project", title: "备份", nodes: [{ id: "node", type: "image", title: "结果", width: 100, height: 100, position: { x: 0, y: 0 }, metadata: { references: ["image:ref"] } }],
        connections: [], chatSessions: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "lines",
    }, files: [{ storageKey: "image:ref", path: "ref.png", mimeType: "image/png", bytes: 3 }] }] };
}

function conversation(id: string): StoredDirectAgentConversation {
    return { id, title: id, createdAt: 1, updatedAt: 1, prompt: "", attachments: [], messages: [], sending: false, activity: "就绪" };
}

describe("画布导入预检与隔离", () => {
    beforeEach(() => {
        mocks.agent = { directConversationsLoaded: true, directConversationsLoading: false, directConversations: [] };
        mocks.readConversations.mockResolvedValue([]);
        mocks.saveConversations.mockResolvedValue(undefined);
    });
    afterEach(() => { vi.clearAllMocks(); mocks.zip.clear(); });
    it("版本、尺寸、连线和缺失资源在写入前拒绝", () => {
        mocks.zip.set("ref.png", new Blob(["ref"]));
        const valid = backup();
        expect(() => validateCanvasImport(valid, mocks.zip)).not.toThrow();
        expect(() => validateCanvasImport({ ...valid, version: 999 }, mocks.zip)).toThrow("版本");
        valid.projects[0].project.nodes[0].width = Infinity;
        expect(() => validateCanvasImport(valid, mocks.zip)).toThrow("尺寸");
        const missing = backup();
        missing.projects[0].files = [];
        expect(() => validateCanvasImport(missing, mocks.zip)).toThrow("缺少被引用");
    });
    it("损坏备份不会创建项目或写入任何图片", async () => {
        mocks.zip.set("projects.json", new Blob([JSON.stringify(backup())]));
        await expect(importCanvasArchive(new Blob())).rejects.toThrow("缺失");
        expect(mocks.setImage).not.toHaveBeenCalled();
        expect(mocks.replaceProjects).not.toHaveBeenCalled();
    });
    it("图片写入失败时只回收本次新资源键", async () => {
        mocks.zip.set("projects.json", new Blob([JSON.stringify(backup())]));
        mocks.zip.set("ref.png", new Blob(["ref"]));
        mocks.setImage.mockRejectedValueOnce(new Error("quota"));
        await expect(importCanvasArchive(new Blob())).rejects.toThrow("quota");
        const key = mocks.setImage.mock.calls[0][0];
        expect(key).not.toBe("image:ref");
        expect(mocks.deleteImages).toHaveBeenCalledWith([key]);
        expect(mocks.replaceProjects).not.toHaveBeenCalled();
    });
    it("成功导入重映射项目 ID 和所有历史参考图键", async () => {
        mocks.zip.set("projects.json", new Blob([JSON.stringify(backup())]));
        mocks.zip.set("ref.png", new Blob(["ref"]));
        mocks.setImage.mockResolvedValueOnce("blob:new");
        await expect(importCanvasArchive(new Blob())).resolves.toEqual({ projects: 1, conversations: 0 });
        const project = mocks.replaceProjects.mock.calls[0][0][0];
        expect(project.id).not.toBe("project");
        expect(project.nodes[0].metadata.references).toEqual([mocks.setImage.mock.calls[0][0]]);
    });

    it("保存导入数据期间的新编辑保留，附件立即使用备份中的图片数据", async () => {
        const restored = conversation("imported");
        const attachment = { id: "attachment", name: "ref.png", type: "image/png", size: 3, width: 1, height: 1, url: "blob:old-browser", dataUrl: "data:image/png;base64,cmVm" };
        restored.attachments = [attachment];
        restored.messages = [{ id: "message", role: "user", text: "参考图", attachments: [attachment] }];
        mocks.agent.directConversations = [conversation("existing")];
        mocks.zip.set("projects.json", new Blob([JSON.stringify({ ...backup(), agentConversations: [restored] })]));
        mocks.zip.set("ref.png", new Blob(["ref"]));
        let finish!: () => void;
        mocks.saveConversations.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
        const importing = importCanvasArchive(new Blob());
        await vi.waitFor(() => expect(mocks.saveConversations).toHaveBeenCalled());
        const imported = mocks.agent.directConversations.find((item) => item.id !== "existing")!;
        expect(imported.attachments[0].url).toBe(attachment.dataUrl);
        expect(imported.messages[0].attachments?.[0].url).toBe(attachment.dataUrl);
        mocks.agent = { ...mocks.agent, directConversations: mocks.agent.directConversations.map((item) => item.id === "existing" ? { ...item, prompt: "导入期间编辑" } : item) };
        finish();
        await importing;
        expect(mocks.agent.directConversations.find((item) => item.id === "existing")?.prompt).toBe("导入期间编辑");
    });

    it("读取旧对话期间完成的加载与新编辑不被读取快照替换", async () => {
        mocks.agent.directConversationsLoaded = false;
        mocks.zip.set("projects.json", new Blob([JSON.stringify({ ...backup(), agentConversations: [conversation("imported")] })]));
        mocks.zip.set("ref.png", new Blob(["ref"]));
        let finish!: (items: StoredDirectAgentConversation[]) => void;
        mocks.readConversations.mockImplementationOnce(() => new Promise<StoredDirectAgentConversation[]>((resolve) => { finish = resolve; }));
        const importing = importCanvasArchive(new Blob());
        await vi.waitFor(() => expect(mocks.readConversations).toHaveBeenCalled());
        mocks.agent = { ...mocks.agent, directConversationsLoaded: true, directConversations: [{ ...conversation("existing"), prompt: "新的草稿" }] };
        finish([conversation("existing")]);
        await importing;
        expect(mocks.agent.directConversations.find((item) => item.id === "existing")?.prompt).toBe("新的草稿");
        expect(mocks.agent.directConversations).toHaveLength(2);
    });

    it("载入后的保存失败保留项目、对话和资源以供重新导出", async () => {
        mocks.zip.set("projects.json", new Blob([JSON.stringify({ ...backup(), agentConversations: [conversation("imported")] })]));
        mocks.zip.set("ref.png", new Blob(["ref"]));
        mocks.saveConversations.mockRejectedValueOnce(new Error("quota"));
        await expect(importCanvasArchive(new Blob())).rejects.toThrow("导入内容已载入");
        expect(mocks.replaceProjects).toHaveBeenCalled();
        expect(mocks.agent.directConversations).toHaveLength(1);
        expect(mocks.deleteImages).not.toHaveBeenCalled();
    });
});
