import localforage from "localforage";

import { upscaleDataUrl } from "@canvas/lib/canvas/canvas-image-data";
import type { AgentAttachment, AgentChatItem } from "@canvas/stores/use-agent-store";

export type StoredAgentUserMessage = Pick<AgentChatItem, "id" | "text" | "attachments"> & { role: "user"; historyText: string; threadId?: string; turnId?: string };
export type StoredDirectAgentConversation = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    prompt: string;
    attachments: AgentAttachment[];
    sending: boolean;
    activity: string;
    messages: AgentChatItem[];
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "agent_chat_messages" });
const mutations = new Map<string, Promise<void>>();
const directConversationsKey = "direct:conversations:v1";
const directConversationsMutationKey = "direct:conversations";
const indexKey = (threadId: string) => `thread:${threadId}`;
const messageKey = (threadId: string, messageId: string) => `message:${threadId}:${messageId}`;
const pendingKey = (messageId: string) => `pending:${messageId}`;
const threadMutationKey = (threadId: string) => `thread:${threadId}`;
const pendingMutationKey = (messageId: string) => `pending:${messageId}`;

export async function saveAgentUserMessage(threadId: string, message: StoredAgentUserMessage) {
    if (!message.attachments?.length) return;
    if (!threadId) return savePendingAgentUserMessage(message);
    await saveThreadAgentUserMessage(threadId, message);
}

/** Persist attachments before a turn is accepted. The record is moved to a thread after the server assigns one. */
export async function savePendingAgentUserMessage(message: StoredAgentUserMessage) {
    if (!message.id || !message.attachments?.length) return;
    await mutateScopes([pendingMutationKey(message.id)], async () => {
        const attachments = await Promise.all(message.attachments!.map(createThumbnail));
        await store.setItem(pendingKey(message.id), { ...message, threadId: undefined, turnId: undefined, attachments });
    });
}

export async function deletePendingAgentUserMessage(messageId: string) {
    if (!messageId) return;
    await mutateScopes([pendingMutationKey(messageId)], () => store.removeItem(pendingKey(messageId)));
}

export async function readAgentUserMessages(threadId: string) {
    await mutations.get(threadMutationKey(threadId))?.catch(() => undefined);
    const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
    return (await Promise.all(ids.map((id) => store.getItem<StoredAgentUserMessage>(messageKey(threadId, id))))).filter((item): item is StoredAgentUserMessage => Boolean(item));
}

/** Bind a pending message to the server thread, preserving an already-known turn id. */
export async function bindPendingAgentUserMessage(threadId: string, messageId: string, turnId = "") {
    if (!threadId || !messageId) return;
    await mutateScopes([pendingMutationKey(messageId), threadMutationKey(threadId)], async () => {
        const pending = await store.getItem<StoredAgentUserMessage>(pendingKey(messageId));
        const key = messageKey(threadId, messageId);
        const existing = await store.getItem<StoredAgentUserMessage>(key);
        if (!pending && !existing) return;
        const message = mergeStoredMessage(existing, pending, threadId, turnId);
        await putThreadMessage(threadId, key, message);
        if (pending) await store.removeItem(pendingKey(messageId));
    });
}

export async function bindAgentUserMessageTurn(threadId: string, messageId: string, turnId: string) {
    await bindPendingAgentUserMessage(threadId, messageId, turnId);
}

export async function moveAgentUserMessage(fromThreadId: string, toThreadId: string, messageId: string) {
    if (!toThreadId || !messageId || fromThreadId === toThreadId) return bindPendingAgentUserMessage(toThreadId, messageId);
    const scopes = [pendingMutationKey(messageId), threadMutationKey(toThreadId), ...(fromThreadId ? [threadMutationKey(fromThreadId)] : [])];
    await mutateScopes(scopes, async () => {
        const pending = await store.getItem<StoredAgentUserMessage>(pendingKey(messageId));
        const fromKey = fromThreadId ? messageKey(fromThreadId, messageId) : "";
        const from = fromKey ? await store.getItem<StoredAgentUserMessage>(fromKey) : null;
        const toKey = messageKey(toThreadId, messageId);
        const existing = await store.getItem<StoredAgentUserMessage>(toKey);
        const source = pending || from;
        if (!source && !existing) return;
        await putThreadMessage(toThreadId, toKey, mergeStoredMessage(existing, source, toThreadId));
        if (pending) await store.removeItem(pendingKey(messageId));
        if (from && fromThreadId) await removeThreadMessage(fromThreadId, fromKey, messageId);
    });
}

export async function deleteAgentThreadMessages(threadIds: string[]) {
    await mutateScopes(threadIds.map(threadMutationKey), async () => {
        await Promise.all(threadIds.map(async (threadId) => {
            const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
            await Promise.all(ids.map((id) => store.removeItem(messageKey(threadId, id))));
            await store.removeItem(indexKey(threadId));
        }));
    });
}

export async function readDirectAgentConversations() {
    await mutations.get(directConversationsMutationKey)?.catch(() => undefined);
    const conversations = await store.getItem<unknown>(directConversationsKey);
    if (!Array.isArray(conversations)) return [];
    return conversations.filter(isStoredDirectAgentConversation).map((conversation) => ({
        ...conversation,
        title: normalizeDirectConversationText(conversation.title, "新对话"),
        sending: false,
        activity: normalizeDirectConversationText(conversation.activity, "就绪"),
        attachments: restoreAttachments(conversation.attachments),
        messages: conversation.messages.map((message) => ({ ...message, attachments: restoreAttachments(message.attachments) })),
    }));
}

export async function saveDirectAgentConversations(conversations: StoredDirectAgentConversation[]) {
    await mutateScopes([directConversationsMutationKey], async () => {
        await store.setItem(directConversationsKey, conversations.map((conversation) => ({
            ...conversation,
            title: normalizeDirectConversationText(conversation.title, "新对话"),
            activity: normalizeDirectConversationText(conversation.activity, "就绪"),
            attachments: persistAttachments(conversation.attachments),
            messages: conversation.messages.map((message) => ({ ...message, attachments: persistAttachments(message.attachments) })),
        })));
    });
}

async function saveThreadAgentUserMessage(threadId: string, message: StoredAgentUserMessage) {
    await mutateScopes([threadMutationKey(threadId)], async () => {
        const attachments = await Promise.all(message.attachments!.map(createThumbnail));
        await putThreadMessage(threadId, messageKey(threadId, message.id), { ...message, threadId, attachments });
    });
}

async function putThreadMessage(threadId: string, key: string, message: StoredAgentUserMessage) {
    await store.setItem(key, { ...message, threadId });
    const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
    if (!ids.includes(message.id)) await store.setItem(indexKey(threadId), [...ids, message.id]);
}

function mergeStoredMessage(existing: StoredAgentUserMessage | null, source: StoredAgentUserMessage | null | undefined, threadId: string, turnId = "") {
    const message = { ...(source || {}), ...(existing || {}) } as StoredAgentUserMessage;
    if (!message.attachments?.length && source?.attachments?.length) message.attachments = source.attachments;
    if (!message.text && source?.text) message.text = source.text;
    if (!message.historyText && source?.historyText) message.historyText = source.historyText;
    return { ...message, threadId, ...(turnId ? { turnId } : message.turnId ? { turnId: message.turnId } : {}) };
}

async function removeThreadMessage(threadId: string, key: string, messageId: string) {
    await store.removeItem(key);
    const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
    const remaining = ids.filter((id) => id !== messageId);
    if (remaining.length) await store.setItem(indexKey(threadId), remaining);
    else await store.removeItem(indexKey(threadId));
}

async function mutateScopes(scopes: string[], mutation: () => Promise<void>) {
    const ids = [...new Set(scopes.filter(Boolean))].sort();
    const operation = Promise.all(ids.map((id) => mutations.get(id)?.catch(() => undefined))).then(mutation);
    ids.forEach((id) => mutations.set(id, operation));
    try {
        await operation;
    } finally {
        ids.forEach((id) => {
            if (mutations.get(id) === operation) mutations.delete(id);
        });
    }
}

async function createThumbnail(attachment: AgentAttachment): Promise<AgentAttachment> {
    const dataUrl = Math.max(attachment.width, attachment.height) > 512 ? await upscaleDataUrl(attachment.dataUrl, { targetLongEdge: 512, algorithm: "high" }) : attachment.dataUrl;
    return { ...attachment, size: dataUrl.length, url: dataUrl, dataUrl };
}

function isStoredDirectAgentConversation(value: unknown): value is StoredDirectAgentConversation {
    if (!value || typeof value !== "object") return false;
    const conversation = value as Partial<StoredDirectAgentConversation>;
    return typeof conversation.id === "string" && typeof conversation.title === "string" && typeof conversation.createdAt === "number" && typeof conversation.updatedAt === "number" && typeof conversation.prompt === "string" && typeof conversation.activity === "string" && Array.isArray(conversation.attachments) && Array.isArray(conversation.messages);
}

function persistAttachments(attachments?: AgentAttachment[]) {
    return (attachments || []).map((attachment) => ({ ...attachment, url: attachment.dataUrl }));
}

function restoreAttachments(attachments?: AgentAttachment[]) {
    return (attachments || []).filter((attachment) => attachment && typeof attachment.dataUrl === "string").map((attachment) => ({ ...attachment, url: attachment.dataUrl }));
}

function normalizeDirectConversationText(value: string, fallback: string) {
    return /^\?+$/.test(value.trim()) ? fallback : value;
}
