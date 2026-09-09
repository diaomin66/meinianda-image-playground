import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXED_GEMINI_PROFILE_ID, FIXED_IMAGE_PROFILE_ID } from "../../lib/fixedApiProfiles";
import { GEMINI_PRO_IMAGE_MODEL, GPT_IMAGE_25_MODELS, GPT_IMAGE_MODELS } from "../../lib/imageModels";
import { useStore } from "../../store";
import { defaultConfig } from "@canvas/stores/use-config-store";
import { buildCanvasGalleryImageConfig, getCanvasGalleryImageParams, getCanvasGalleryModelOptions, requestCanvasGalleryImages } from "./gallery-image-bridge";

const mocks = vi.hoisted(() => ({
    callImageApi: vi.fn(),
    removeBackground: vi.fn(async () => "data:image/png;base64,transparent"),
}));

vi.mock("../../lib/api", () => ({
    callImageApi: mocks.callImageApi,
}));
vi.mock("../../lib/transparentImage", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../lib/transparentImage")>(),
    removeKeyedBackgroundFromDataUrl: mocks.removeBackground,
}));

describe("gallery image bridge", () => {
    const originalSettings = useStore.getState().settings;
    const originalParams = useStore.getState().params;

    afterEach(() => {
        useStore.setState({ settings: originalSettings, params: originalParams });
        mocks.callImageApi.mockReset();
        mocks.removeBackground.mockClear();
        vi.unstubAllGlobals();
    });

    it("画布模型菜单将三个 GPT Image 模型归入 Images API", () => {
        const options = getCanvasGalleryModelOptions(originalSettings).filter((option) => option.profileId === FIXED_IMAGE_PROFILE_ID);
        expect(options.map((option) => option.model)).toEqual(GPT_IMAGE_MODELS);
    });

    it.each(GPT_IMAGE_25_MODELS)("%s 的画布快照使用指定模型、扩展质量和原生透明 PNG", async (model) => {
        mocks.callImageApi.mockResolvedValue({ images: ["data:image/png;base64,result"] });
        for (const quality of ["xhigh", "max"] as const) {
            const params = { ...originalParams, quality, size: "3840x2160", background: "transparent" as const, output_format: "png" as const, transparent_output: false };
            const config = buildCanvasGalleryImageConfig(defaultConfig, {
                imageProfileId: FIXED_IMAGE_PROFILE_ID,
                model,
                imageParamsSnapshot: params,
            });
            expect(config.model).toBe(model);
            expect(config.galleryImageParams).toEqual(params);
            await requestCanvasGalleryImages(config, "透明背景的小猫", []);
            const request = mocks.callImageApi.mock.calls[mocks.callImageApi.mock.calls.length - 1][0];
            expect(request.settings.profiles.find((profile: { id: string }) => profile.id === FIXED_IMAGE_PROFILE_ID)?.model).toBe(model);
            expect(request.params).toEqual(params);
            expect(request.prompt).toBe("透明背景的小猫");
            expect(mocks.removeBackground).not.toHaveBeenCalled();
        }
    });

    it("已有结果按快照重试，新配置仍继承全局默认值", () => {
        useStore.setState({ params: { ...originalParams, output_format: "jpeg" } });
        expect(getCanvasGalleryImageParams({ imageParamsSnapshot: { ...originalParams, output_format: "png" } }).output_format).toBe("png");
        expect(getCanvasGalleryImageParams(undefined).output_format).toBe("jpeg");
        expect(getCanvasGalleryImageParams({ imageParamsSnapshot: { ...originalParams, output_format: "png" }, imageParams: { output_format: "webp" } }).output_format).toBe("webp");
    });

    it("桥接层转换 Blob 参考图和遮罩，并传递取消信号", async () => {
        mocks.callImageApi.mockResolvedValue({ images: ["data:image/png;base64,result"] });
        const fetch = vi.fn(async () => new Response(new Blob(["ref"], { type: "image/png" })));
        vi.stubGlobal("fetch", fetch);
        const config = buildCanvasGalleryImageConfig(defaultConfig, undefined);
        const ref = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "blob:reference" };
        const controller = new AbortController();
        await requestCanvasGalleryImages(config, "编辑", [ref], ref, controller.signal);
        expect(mocks.callImageApi).toHaveBeenCalledWith(expect.objectContaining({
            inputImageDataUrls: ["data:image/png;base64,cmVm"], maskDataUrl: "data:image/png;base64,cmVm", signal: controller.signal,
        }));
    });

    it("透明增强添加提示词并执行抠图，仅在 PNG 时启用", async () => {
        mocks.callImageApi.mockResolvedValue({ images: ["data:image/png;base64,original"] });
        const config = buildCanvasGalleryImageConfig(defaultConfig, { imageParams: { transparent_output: true, output_format: "png" } });
        const images = await requestCanvasGalleryImages(config, "猫", []);
        expect(mocks.callImageApi.mock.calls[0][0].prompt).toContain("[背景指令]");
        expect(images?.[0].dataUrl).toBe("data:image/png;base64,transparent");
        expect(mocks.removeBackground).toHaveBeenCalledWith("data:image/png;base64,original");
        await requestCanvasGalleryImages(buildCanvasGalleryImageConfig(defaultConfig, { imageParams: { transparent_output: true, output_format: "jpeg" } }), "猫", []);
        expect(mocks.removeBackground).toHaveBeenCalledTimes(1);
    });

    it("缺失参考图或提前取消时不发送生成请求", async () => {
        const config = buildCanvasGalleryImageConfig(defaultConfig, undefined);
        await expect(requestCanvasGalleryImages(config, "猫", [{ id: "ref", name: "ref", type: "image/png", dataUrl: "" }])).rejects.toThrow("已丢失");
        const controller = new AbortController();
        controller.abort();
        await expect(requestCanvasGalleryImages(config, "猫", [], undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(mocks.callImageApi).not.toHaveBeenCalled();
    });

    it("uses the selected Gallery profile, model and complete task params", () => {
        useStore.setState({
            params: { ...originalParams, n: 2, size: "1024x1024" },
        });

        const config = buildCanvasGalleryImageConfig(defaultConfig, {
            imageProfileId: FIXED_GEMINI_PROFILE_ID,
            model: GEMINI_PRO_IMAGE_MODEL,
            imageParams: { n: 3, aspect_ratio: "16:9", thinking_level: "high" },
        });

        expect(config.galleryImageProfileId).toBe(FIXED_GEMINI_PROFILE_ID);
        expect(config.model).toBe(GEMINI_PRO_IMAGE_MODEL);
        expect(config.galleryImageParams).toMatchObject({
            n: 3,
            size: "1024x1024",
            aspect_ratio: "16:9",
            thinking_level: "high",
        });
    });

    it("calls the Gallery API directly without creating a Gallery task", async () => {
        mocks.callImageApi.mockResolvedValue({ images: ["data:image/png;base64,result"] });
        const config = {
            ...buildCanvasGalleryImageConfig(defaultConfig, {
                imageProfileId: FIXED_GEMINI_PROFILE_ID,
                model: GEMINI_PRO_IMAGE_MODEL,
                imageParams: { n: 4, aspect_ratio: "16:9" },
            }),
            count: "1",
        };
        const tasks = useStore.getState().tasks;

        const images = await requestCanvasGalleryImages(config, "画一只猫", [{ id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,ref" }]);

        expect(images).toEqual([{ id: `${FIXED_GEMINI_PROFILE_ID}-0`, dataUrl: "data:image/png;base64,result" }]);
        expect(useStore.getState().tasks).toBe(tasks);
        expect(mocks.callImageApi).toHaveBeenCalledWith(expect.objectContaining({
            prompt: "画一只猫",
            inputImageDataUrls: ["data:image/png;base64,ref"],
            params: expect.objectContaining({ n: 1, aspect_ratio: "16:9" }),
            settings: expect.objectContaining({ activeProfileId: FIXED_GEMINI_PROFILE_ID }),
        }));
        const request = mocks.callImageApi.mock.calls[0][0];
        expect(request.settings.profiles.find((profile: { id: string }) => profile.id === FIXED_GEMINI_PROFILE_ID)?.model).toBe(GEMINI_PRO_IMAGE_MODEL);
    });
});
