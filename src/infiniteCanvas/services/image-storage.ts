import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@canvas/lib/image-utils";
import { collectStorageKeys } from "../../lib/storageReferences";
import { blobToDataUrl } from "../../lib/dataUrl";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    persistence?: "indexeddb" | "cache" | "memory";
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    transparentOriginalStorageKey?: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();
const IMAGE_CACHE_NAME = "infinite-canvas-image-files-v1";
const IMAGE_CACHE_PATH = "/__infinite_canvas_image__";
export const CANVAS_IMAGE_STORAGE_FALLBACK_EVENT = "canvas-image-storage-fallback";
let lastFallbackNotice = 0;

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `image:${nanoid()}`;
    const persistence = await persistImageBlob(storageKey, blob);
    const url = URL.createObjectURL(blob);
    if (persistence !== "memory") objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, ...(persistence !== "memory" ? { storageKey } : {}), persistence, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await getImageBlob(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string): Promise<Blob | null> {
    try {
        const blob = await store.getItem<Blob>(storageKey);
        if (blob) return blob;
    } catch (error) {
        console.warn("Failed to read image from IndexedDB, trying Cache Storage.", error);
    }
    return readCachedImage(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (await persistImageBlob(storageKey, blob) === "memory") throw new Error("图片存储空间不足，无法持久保存");
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const url = image.storageKey ? await resolveImageUrl(image.storageKey, image.dataUrl || image.url || "") : image.dataUrl || image.url || "";
    if (!url) throw new Error("参考图片已丢失，无法继续生成");
    if (url.startsWith("data:")) return url;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`参考图片读取失败：HTTP ${response.status}`);
    return blobToDataUrl(await response.blob());
}

export async function uploadGeneratedImage(image: { dataUrl: string; originalDataUrl?: string }, signal: AbortSignal): Promise<UploadedImage> {
    signal.throwIfAborted();
    const uploaded = await uploadImage(image.dataUrl);
    const created = uploaded.storageKey ? [uploaded.storageKey] : [];
    try {
        signal.throwIfAborted();
        if (image.originalDataUrl) {
            const original = await uploadImage(image.originalDataUrl);
            if (original.storageKey) created.push(original.storageKey);
            uploaded.transparentOriginalStorageKey = original.storageKey;
        }
        signal.throwIfAborted();
        return uploaded;
    } catch (error) {
        await deleteStoredImages(created);
        throw error;
    }
}

export async function deleteStoredImages(keys: Iterable<string>) {
    const cache = await openImageCache();
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            try {
                await store.removeItem(key);
            } catch (error) {
                console.warn("Failed to delete image from IndexedDB.", error);
            }
            await cache?.delete(cacheRequest(key));
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    try {
        await store.iterate((_value, key) => {
            if (!usedKeys.has(key)) unused.push(key);
        });
    } catch (error) {
        console.warn("Failed to inspect IndexedDB image storage.", error);
    }
    const cache = await openImageCache();
    if (cache) {
        const requests = await cache.keys();
        requests.forEach((request) => {
            const key = new URL(request.url).searchParams.get("key");
            if (key && !usedKeys.has(key)) unused.push(key);
        });
    }
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    for (const key of collectStorageKeys(value)) {
        if (key.startsWith("image:")) keys.add(key);
    }
    return keys;
}

export function isStorageQuotaError(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const value = error as { name?: unknown; message?: unknown };
    const name = typeof value.name === "string" ? value.name : "";
    const message = typeof value.message === "string" ? value.message : "";
    return name === "QuotaExceededError" || /quota|transaction exceeded its quota limitations/i.test(message);
}

async function persistImageBlob(storageKey: string, blob: Blob): Promise<UploadedImage["persistence"]> {
    try {
        await store.setItem(storageKey, blob);
        return "indexeddb";
    } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        console.warn("IndexedDB image quota exceeded, trying Cache Storage.", error);
    }

    try {
        const cache = await openImageCache();
        if (cache) {
            await cache.put(cacheRequest(storageKey), new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }));
            return "cache";
        }
    } catch (error) {
        console.warn("Cache Storage image fallback failed; using an in-memory URL.", error);
    }

    notifyMemoryFallback();
    return "memory";
}

async function readCachedImage(storageKey: string) {
    try {
        const response = await (await openImageCache())?.match(cacheRequest(storageKey));
        return response ? await response.blob() : null;
    } catch (error) {
        console.warn("Failed to read image from Cache Storage.", error);
        return null;
    }
}

async function openImageCache() {
    return typeof caches === "undefined" ? null : caches.open(IMAGE_CACHE_NAME);
}

function cacheRequest(storageKey: string) {
    const origin = typeof location === "undefined" ? "https://infinite-canvas.local" : location.origin;
    return new Request(`${origin}${IMAGE_CACHE_PATH}?key=${encodeURIComponent(storageKey)}`);
}

function notifyMemoryFallback() {
    const now = Date.now();
    if (now - lastFallbackNotice < 5000) return;
    lastFallbackNotice = now;
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CANVAS_IMAGE_STORAGE_FALLBACK_EVENT));
}
