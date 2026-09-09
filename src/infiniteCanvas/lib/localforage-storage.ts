import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

const pendingWrites = new Map<string, Promise<void>>();

function queueWrite(name: string, write: () => Promise<void>) {
    const pending = (pendingWrites.get(name) || Promise.resolve()).catch(() => {}).then(write);
    pendingWrites.set(name, pending);
    const clear = () => {
        if (pendingWrites.get(name) === pending) pendingWrites.delete(name);
    };
    void pending.then(clear, clear);
    return pending;
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        await pendingWrites.get(name)?.catch(() => {});
        // 备用值代表主库写入失败后的新版本，优先于主库的旧值。
        try {
            if (window.localStorage.getItem(`${name}:deleted`)) return null;
            const fallback = window.localStorage.getItem(name);
            if (fallback !== null) return fallback;
        } catch (error) {
            console.warn("无法读取画布备用存储，尝试主存储", error);
        }
        return (await localforage.getItem<string>(name)) ?? null;
    },
    setItem: (name, value) => queueWrite(name, async () => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch (error) {
            console.warn("画布主存储写入失败，使用备用存储", error);
            window.localStorage.setItem(name, value);
            window.localStorage.removeItem(`${name}:deleted`);
            return;
        }
        window.localStorage.removeItem(name);
        window.localStorage.removeItem(`${name}:deleted`);
    }),
    removeItem: (name) => queueWrite(name, async () => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch (error) {
            console.warn("画布主存储删除失败，记录删除状态", error);
            window.localStorage.setItem(`${name}:deleted`, "1");
            window.localStorage.removeItem(name);
            return;
        }
        window.localStorage.removeItem(name);
        window.localStorage.removeItem(`${name}:deleted`);
    }),
};
