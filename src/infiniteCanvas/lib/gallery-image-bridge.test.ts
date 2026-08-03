import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXED_GEMINI_PROFILE_ID } from "../../lib/fixedApiProfiles";
import { GEMINI_PRO_IMAGE_MODEL } from "../../lib/imageModels";
import { useStore } from "../../store";
import { defaultConfig } from "@canvas/stores/use-config-store";
import { buildCanvasGalleryImageConfig, requestCanvasGalleryImages } from "./gallery-image-bridge";

const mocks = vi.hoisted(() => ({
    callImageApi: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
    callImageApi: mocks.callImageApi,
}));

describe("gallery image bridge", () => {
    const originalSettings = useStore.getState().settings;
    const originalParams = useStore.getState().params;

    afterEach(() => {
        useStore.setState({ settings: originalSettings, params: originalParams });
        mocks.callImageApi.mockReset();
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
