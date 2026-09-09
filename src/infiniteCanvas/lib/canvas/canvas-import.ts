import { nanoid } from "nanoid";
import { collectStorageKeys } from "../../../lib/storageReferences";
import { preserveConcurrentChanges } from "../../../lib/syncMerge";
import { readZip } from "@canvas/lib/zip";
import { deleteStoredImages, getImageBlob, setImageBlob } from "@canvas/services/image-storage";
import { deleteStoredMedia, getMediaBlob, setMediaBlob } from "@canvas/services/file-storage";
import { readDirectAgentConversations, saveDirectAgentConversations } from "@canvas/services/agent-chat-storage";
import { flushCanvasSave, useCanvasStore } from "@canvas/stores/canvas/use-canvas-store";
import { useAgentStore } from "@canvas/stores/use-agent-store";
import type { CanvasExportFile } from "@canvas/types/canvas-export";

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function validateCanvasImport(value: unknown, zip: Map<string, Blob>): asserts value is CanvasExportFile {
    if (!record(value) || value.app !== "infinite-canvas" || value.version !== 3 || !Array.isArray(value.projects)) throw new Error("不支持的画布备份格式或版本");
    const projectIds = new Set<string>();
    for (const entry of value.projects) {
        if (!record(entry) || !record(entry.project) || !Array.isArray(entry.files)) throw new Error("画布项目结构不完整");
        const project = entry.project;
        if (typeof project.id !== "string" || !project.id || projectIds.has(project.id) || typeof project.title !== "string" || !Array.isArray(project.nodes) || !Array.isArray(project.connections) || !Array.isArray(project.chatSessions)) throw new Error("画布项目数据无效或 ID 重复");
        projectIds.add(project.id);
        if (!record(project.viewport) || ![project.viewport.x, project.viewport.y, project.viewport.k].every((n) => typeof n === "number" && Number.isFinite(n)) || Number(project.viewport.k) <= 0) throw new Error("画布视口参数无效");
        if (!["lines", "dots", "blank"].includes(String(project.backgroundMode))) throw new Error("画布背景参数无效");
        const ids = new Set<string>();
        for (const node of project.nodes) {
            if (!record(node) || typeof node.id !== "string" || !node.id || ids.has(node.id) || typeof node.type !== "string" || !record(node.position) || ![node.position.x, node.position.y, node.width, node.height].every((n) => typeof n === "number" && Number.isFinite(n)) || Number(node.width) <= 0 || Number(node.height) <= 0 || (node.metadata !== undefined && !record(node.metadata))) throw new Error("节点结构、ID 或尺寸无效");
            ids.add(node.id);
        }
        const connections = new Set<string>();
        for (const connection of project.connections) {
            if (!record(connection) || typeof connection.id !== "string" || connections.has(connection.id) || !ids.has(String(connection.fromNodeId)) || !ids.has(String(connection.toNodeId))) throw new Error("连线引用了不存在的节点或 ID 重复");
            connections.add(connection.id);
        }
        for (const session of project.chatSessions) {
            if (!record(session) || typeof session.id !== "string" || !Array.isArray(session.messages) || session.messages.some((msg) => !record(msg) || (msg.references !== undefined && !Array.isArray(msg.references)))) throw new Error("画布历史对话结构无效");
        }
        const assets = new Set<string>();
        for (const item of entry.files) {
            if (!record(item) || typeof item.storageKey !== "string" || !/^(image|video|audio|file|video-reference|audio-reference):.+/.test(item.storageKey) || assets.has(item.storageKey) || typeof item.path !== "string" || !zip.has(item.path) || typeof item.mimeType !== "string" || typeof item.bytes !== "number" || !Number.isFinite(item.bytes) || item.bytes !== zip.get(item.path)!.size) throw new Error("备份资源缺失、重复或大小不符");
            assets.add(item.storageKey);
        }
        for (const key of collectStorageKeys(project)) {
            if (!assets.has(key)) throw new Error(`备份缺少被引用的资源：${key}`);
        }
    }
    if (value.agentConversations !== undefined) {
        if (!Array.isArray(value.agentConversations)) throw new Error("Canvas Agent 对话格式无效");
        const ids = new Set<string>();
        for (const conversation of value.agentConversations) {
            if (!record(conversation) || typeof conversation.id !== "string" || !conversation.id || ids.has(conversation.id) || typeof conversation.title !== "string" || typeof conversation.prompt !== "string" || ![conversation.createdAt, conversation.updatedAt].every((n) => typeof n === "number" && Number.isFinite(n)) || !Array.isArray(conversation.messages) || !Array.isArray(conversation.attachments)) throw new Error("Canvas Agent 对话结构无效");
            ids.add(conversation.id);
            for (const msg of conversation.messages) {
                if (!record(msg) || typeof msg.id !== "string" || typeof msg.text !== "string" || !["user", "assistant", "system", "tool", "error"].includes(String(msg.role)) || (msg.attachments !== undefined && !Array.isArray(msg.attachments))) throw new Error("Canvas Agent 消息结构无效");
            }
            const attachments = [...conversation.attachments, ...conversation.messages.flatMap((msg) => msg.attachments || [])];
            if (attachments.some((item) => !record(item) || typeof item.id !== "string" || typeof item.dataUrl !== "string" || !item.dataUrl.startsWith("data:"))) throw new Error("Canvas Agent 附件不完整");
        }
    }
}

export async function importCanvasArchive(file: Blob) {
    const zip = await readZip(file);
    const json = zip.get("projects.json");
    if (!json) throw new Error("备份缺少 projects.json");
    const data: unknown = JSON.parse(await json.text());
    validateCanvasImport(data, zip);
    const keys = new Map<string, string>();
    const created: string[] = [];
    let applied = false;
    try {
        // 隔离资源键，导入失败时只清理本轮资源，不覆盖已有项目的图片。
        for (const entry of data.projects) {
            for (const item of entry.files) {
                if (keys.has(item.storageKey)) continue;
                let key: string;
                do { key = `${item.storageKey.split(":")[0]}:${nanoid()}`; }
                while (await (key.startsWith("image:") ? getImageBlob(key) : getMediaBlob(key)));
                keys.set(item.storageKey, key);
                created.push(key);
                const blob = zip.get(item.path)!;
                const typed = blob.slice(0, blob.size, item.mimeType);
                await (key.startsWith("image:") ? setImageBlob(key, typed) : setMediaBlob(key, typed));
            }
        }
        const now = new Date().toISOString();
        const projects = data.projects.map((entry) => ({
            ...JSON.parse(JSON.stringify(entry.project), (_key, value) => typeof value === "string" ? keys.get(value) || value : value),
            id: nanoid(), updatedAt: now,
        }));
        let conversations;
        if (data.agentConversations?.length) {
            const agent = useAgentStore.getState();
            const saved = agent.directConversationsLoaded ? agent.directConversations : await readDirectAgentConversations();
            const current = useAgentStore.getState();
            const existing = current.directConversationsLoaded ? current.directConversations : preserveConcurrentChanges(agent.directConversations, current.directConversations, saved);
            conversations = [...existing, ...data.agentConversations.map((conversation) => ({
                ...conversation, id: nanoid(), sending: false, activity: "已从备份恢复",
                attachments: conversation.attachments.map((attachment) => ({ ...attachment, url: attachment.dataUrl })),
                messages: conversation.messages.map((message) => ({ ...message, attachments: message.attachments?.map((attachment) => ({ ...attachment, url: attachment.dataUrl })) })),
            }))];
        }
        useCanvasStore.getState().replaceProjects([...projects, ...useCanvasStore.getState().projects]);
        applied = true;
        // 先更新内存，再等待保存，期间的新编辑会包含导入内容，不被旧快照覆盖。
        if (conversations) {
            useAgentStore.setState({ directConversations: conversations, directConversationsLoaded: true, directConversationsLoading: false });
            await saveDirectAgentConversations(conversations);
        }
        await flushCanvasSave();
        return { projects: projects.length, conversations: data.agentConversations?.length || 0 };
    } catch (error) {
        if (!applied) {
            await Promise.allSettled([deleteStoredImages(created.filter((key) => key.startsWith("image:"))), deleteStoredMedia(created.filter((key) => !key.startsWith("image:")))]);
        } else {
            throw new Error("导入内容已载入，但保存失败，请保留页面并重试保存或重新导出备份");
        }
        throw error;
    }
}
