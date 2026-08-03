import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    setItem: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
    iterate: vi.fn(),
    cacheEntries: new Map<string, Response>(),
    cachePut: vi.fn(),
    cacheMatch: vi.fn(),
    cacheDelete: vi.fn(),
    cacheKeys: vi.fn(),
    cacheOpen: vi.fn(),
    readImageMeta: vi.fn(),
}));

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            setItem: mocks.setItem,
            getItem: mocks.getItem,
            removeItem: mocks.removeItem,
            iterate: mocks.iterate,
        }),
    },
}));

vi.mock("@canvas/lib/image-utils", () => ({
    readImageMeta: mocks.readImageMeta,
}));

import {
    CANVAS_IMAGE_STORAGE_FALLBACK_EVENT,
    isStorageQuotaError,
    uploadImage,
} from "./image-storage";

describe("canvas image storage", () => {
    beforeEach(() => {
        mocks.cacheEntries.clear();
        mocks.setItem.mockReset().mockResolvedValue(undefined);
        mocks.getItem.mockReset().mockResolvedValue(null);
        mocks.removeItem.mockReset().mockResolvedValue(undefined);
        mocks.iterate.mockReset().mockResolvedValue(undefined);
        mocks.readImageMeta.mockReset().mockResolvedValue({ width: 1024, height: 768, mimeType: "image/png" });
        mocks.cachePut.mockReset().mockImplementation(async (request: Request, response: Response) => {
            mocks.cacheEntries.set(request.url, response.clone());
        });
        mocks.cacheMatch.mockReset().mockImplementation(async (request: Request) => mocks.cacheEntries.get(request.url)?.clone());
        mocks.cacheDelete.mockReset().mockImplementation(async (request: Request) => mocks.cacheEntries.delete(request.url));
        mocks.cacheKeys.mockReset().mockImplementation(async () => Array.from(mocks.cacheEntries.keys()).map((url) => new Request(url)));
        mocks.cacheOpen.mockReset().mockResolvedValue({
            put: mocks.cachePut,
            match: mocks.cacheMatch,
            delete: mocks.cacheDelete,
            keys: mocks.cacheKeys,
        });
        vi.stubGlobal("window", new EventTarget());
        vi.stubGlobal("caches", { open: mocks.cacheOpen });
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:canvas-image");
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("stores generated images in IndexedDB normally", async () => {
        const image = await uploadImage(new Blob(["image"], { type: "image/png" }));

        expect(image).toMatchObject({
            url: "blob:canvas-image",
            persistence: "indexeddb",
            width: 1024,
            height: 768,
            mimeType: "image/png",
        });
        expect(image.storageKey).toMatch(/^image:/);
        expect(mocks.cachePut).not.toHaveBeenCalled();
    });

    it("falls back to persistent Cache Storage when IndexedDB exceeds its quota", async () => {
        mocks.setItem.mockRejectedValue(new DOMException("The current transaction exceeded its quota limitations.", "QuotaExceededError"));

        const image = await uploadImage(new Blob(["image"], { type: "image/png" }));

        expect(image.persistence).toBe("cache");
        expect(image.storageKey).toMatch(/^image:/);
        expect(mocks.cachePut).toHaveBeenCalledTimes(1);
    });

    it("keeps a successful image visible in memory when all persistent storage is full", async () => {
        mocks.setItem.mockRejectedValue(new DOMException("The current transaction exceeded its quota limitations.", "QuotaExceededError"));
        mocks.cacheOpen.mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));
        const fallback = vi.fn();
        window.addEventListener(CANVAS_IMAGE_STORAGE_FALLBACK_EVENT, fallback);

        const image = await uploadImage(new Blob(["image"], { type: "image/png" }));

        expect(image).toMatchObject({ url: "blob:canvas-image", persistence: "memory" });
        expect("storageKey" in image).toBe(false);
        expect(fallback).toHaveBeenCalledTimes(1);
        window.removeEventListener(CANVAS_IMAGE_STORAGE_FALLBACK_EVENT, fallback);
    });

    it("does not hide unrelated storage failures", async () => {
        mocks.setItem.mockRejectedValue(new Error("database corrupted"));

        await expect(uploadImage(new Blob(["image"], { type: "image/png" }))).rejects.toThrow("database corrupted");
    });

    it("recognizes the Firefox transaction quota message", () => {
        expect(isStorageQuotaError(new Error("The current transaction exceeded its quota limitations."))).toBe(true);
        expect(isStorageQuotaError(new DOMException("Quota exceeded", "QuotaExceededError"))).toBe(true);
        expect(isStorageQuotaError(new Error("network failed"))).toBe(false);
    });
});
