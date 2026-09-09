import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock("localforage", () => ({ default: { ...mocks, config: vi.fn() } }));
import { localForageStorage } from "./localforage-storage";

describe("画布备用存储恢复", () => {
    const disk = new Map<string, string>();
    beforeEach(() => {
        disk.clear();
        mocks.getItem.mockReset().mockResolvedValue("old-project");
        mocks.setItem.mockReset().mockRejectedValue(new Error("quota"));
        mocks.removeItem.mockReset().mockResolvedValue(undefined);
        vi.stubGlobal("window", { localStorage: {
            getItem: (name: string) => disk.get(name) ?? null,
            setItem: (name: string, value: string) => disk.set(name, value),
            removeItem: (name: string) => disk.delete(name),
        } });
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it.each([null, "old-project"])("主库返回 %s 时恢复最新备用值", async (primary) => {
        mocks.getItem.mockResolvedValue(primary);
        await localForageStorage.setItem("project", "new-project");
        expect(await localForageStorage.getItem("project")).toBe("new-project");
    });
    it("主库恢复写入后清除过时备用值", async () => {
        await localForageStorage.setItem("project", "fallback");
        mocks.setItem.mockResolvedValue(undefined);
        mocks.getItem.mockResolvedValue("recovered");
        await localForageStorage.setItem("project", "recovered");
        expect(disk.has("project")).toBe(false);
        expect(await localForageStorage.getItem("project")).toBe("recovered");
    });
    it("删除失败时不会从主库复活旧数据，重新写入可解除删除标记", async () => {
        mocks.removeItem.mockRejectedValue(new Error("unavailable"));
        await localForageStorage.removeItem("project");
        expect(await localForageStorage.getItem("project")).toBeNull();
        await localForageStorage.setItem("project", "new");
        expect(await localForageStorage.getItem("project")).toBe("new");
    });
    it("连续写入按顺序提交，恢复不会读到前一次值", async () => {
        let finish!: () => void;
        mocks.setItem.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
        const first = localForageStorage.setItem("project", "first");
        const second = localForageStorage.setItem("project", "second");
        await vi.waitFor(() => expect(finish).toBeDefined());
        expect(mocks.setItem).toHaveBeenCalledTimes(1);
        finish();
        await Promise.all([first, second]);
        expect(mocks.setItem.mock.calls.map((call) => call[1])).toEqual(["first", "second"]);
    });
});
