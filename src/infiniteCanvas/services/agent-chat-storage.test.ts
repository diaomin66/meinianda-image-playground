import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setItem: vi.fn(), getItem: vi.fn() }));
vi.mock("localforage", () => ({ default: { createInstance: () => mocks } }));
import { readDirectAgentConversations, saveDirectAgentConversations, type StoredDirectAgentConversation } from "./agent-chat-storage";

const conversation: StoredDirectAgentConversation = { id: "chat", title: "对话", prompt: "", createdAt: 1, updatedAt: 1, attachments: [], sending: false, activity: "就绪", messages: [] };
describe("Canvas Agent 连续保存", () => {
    beforeEach(() => { mocks.setItem.mockReset().mockResolvedValue(undefined); mocks.getItem.mockReset().mockResolvedValue([]); });

    it("写入尚未完成时合并中间草稿，最终保存最新内容", async () => {
        let release!: () => void;
        mocks.setItem.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
        const first = saveDirectAgentConversations([conversation]);
        await vi.waitFor(() => expect(release).toBeDefined());
        const pending = Array.from({ length: 100 }, (_, idx) => saveDirectAgentConversations([{ ...conversation, prompt: String(idx) }]));
        release();
        await Promise.all([first, ...pending]);
        expect(mocks.setItem).toHaveBeenCalledTimes(2);
        expect(mocks.setItem.mock.calls[1][1][0].prompt).toBe("99");
    });

    it("失败会报告给调用方，后续保存仍能成功", async () => {
        mocks.setItem.mockRejectedValueOnce(new Error("quota"));
        await expect(saveDirectAgentConversations([conversation])).rejects.toThrow("quota");
        await saveDirectAgentConversations([{ ...conversation, prompt: "retry" }]);
        const calls = mocks.setItem.mock.calls;
        expect(calls[calls.length - 1]?.[1][0].prompt).toBe("retry");
        await readDirectAgentConversations();
    });
});
