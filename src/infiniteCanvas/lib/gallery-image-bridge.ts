import { callImageApi } from "../../lib/api";
import { getActiveApiProfile, getAgentTextApiProfile, normalizeSettings } from "../../lib/apiProfiles";
import { FIXED_GEMINI_PROFILE_ID, FIXED_IMAGE_PROFILE_ID } from "../../lib/fixedApiProfiles";
import { GEMINI_FLASH_IMAGE_MODEL, GEMINI_PRO_IMAGE_MODEL, GPT_IMAGE_MODELS } from "../../lib/imageModels";
import { getChangedParams, normalizeParamsForSettings } from "../../lib/paramCompatibility";
import { useStore } from "../../store";
import { createTransparentOutputMeta, getTransparentRequestParams, removeKeyedBackgroundFromDataUrl } from "../../lib/transparentImage";
import { imageToDataUrl } from "@canvas/services/image-storage";
import type { ApiProfile, AppSettings, TaskParams } from "../../types";
import type { AiConfig } from "@canvas/stores/use-config-store";
import type { CanvasNodeMetadata } from "@canvas/types/canvas";
import type { ReferenceImage } from "@canvas/types/image";

export type CanvasGalleryModelOption = {
    value: string;
    profileId: string;
    model: string;
    label: string;
};

function settingsForProfile(settings: AppSettings, profileId: string, model?: string) {
    return normalizeSettings({
        ...settings,
        activeProfileId: profileId,
        profiles: settings.profiles.map((profile) => profile.id === profileId && model?.trim() ? { ...profile, model: model.trim() } : profile),
    });
}

function isImageProfile(profile: ApiProfile) {
    return profile.apiMode === "images";
}

export function getCanvasGalleryImageProfile(settings: AppSettings, profileId?: string) {
    const normalized = normalizeSettings(settings);
    const active = getActiveApiProfile(normalized);
    const selected = normalized.profiles.find((profile) => profile.id === profileId && isImageProfile(profile));
    return selected || (isImageProfile(active) ? active : normalized.profiles.find(isImageProfile) || active);
}

export function getCanvasGalleryModelOptions(settings: AppSettings): CanvasGalleryModelOption[] {
    const normalized = normalizeSettings(settings);
    return normalized.profiles.filter(isImageProfile).flatMap((profile) => {
        if (profile.id === FIXED_IMAGE_PROFILE_ID) {
            return GPT_IMAGE_MODELS.map((model) => ({ value: `${profile.id}:${model}`, profileId: profile.id, model, label: model }));
        }
        if (profile.id === FIXED_GEMINI_PROFILE_ID) {
            return [GEMINI_FLASH_IMAGE_MODEL, GEMINI_PRO_IMAGE_MODEL].map((model) => ({ value: `${profile.id}:${model}`, profileId: profile.id, model, label: model }));
        }
        return [{ value: `${profile.id}:${profile.model}`, profileId: profile.id, model: profile.model, label: `${profile.model} · ${profile.name}` }];
    });
}

export function getCanvasGalleryImageModel(settings: AppSettings, profileId?: string, model?: string) {
    const profile = getCanvasGalleryImageProfile(settings, profileId);
    const options = getCanvasGalleryModelOptions(settings).filter((option) => option.profileId === profile.id);
    return options.find((option) => option.model === model)?.model || options.find((option) => option.model === profile.model)?.model || profile.model;
}

function legacyImageParams(metadata: CanvasNodeMetadata | undefined): Partial<TaskParams> {
    if (!metadata) return {};
    return {
        ...(metadata.size ? { size: metadata.size } : {}),
        ...(metadata.quality ? { quality: metadata.quality as TaskParams["quality"] } : {}),
        ...(metadata.background ? { background: metadata.background as TaskParams["background"] } : {}),
        ...(metadata.count ? { n: metadata.count } : {}),
    };
}

export function getCanvasGalleryImageParams(metadata: CanvasNodeMetadata | undefined, profileId?: string, hasInputImages = false) {
    const state = useStore.getState();
    void profileId;
    void hasInputImages;
    return { ...state.params, ...legacyImageParams(metadata), ...metadata?.imageParamsSnapshot, ...metadata?.imageParams };
}

export function createCanvasImageParamsPatch(metadata: CanvasNodeMetadata | undefined, params: TaskParams): Pick<CanvasNodeMetadata, "imageParams" | "imageParamsSnapshot" | "size" | "quality" | "background" | "count"> {
    const globalParams = useStore.getState().params;
    return {
        imageParams: getChangedParams(globalParams, params),
        imageParamsSnapshot: params,
        size: params.size,
        quality: params.quality,
        background: params.background,
        count: params.n,
    };
}

export function buildCanvasGalleryImageConfig(config: AiConfig, metadata: CanvasNodeMetadata | undefined, hasInputImages = false): AiConfig {
    const state = useStore.getState();
    const profile = getCanvasGalleryImageProfile(state.settings, metadata?.imageProfileId);
    const model = getCanvasGalleryImageModel(state.settings, profile.id, metadata?.model);
    const params = getCanvasGalleryImageParams(metadata, profile.id, hasInputImages);
    return {
        ...config,
        model,
        imageModel: model,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        apiFormat: profile.provider === "gemini" ? "gemini" : "openai",
        quality: params.quality,
        size: params.size,
        background: params.background === "auto" ? "" : params.background,
        count: String(params.n),
        galleryImageProfileId: profile.id,
        galleryImageParams: { ...params, n: params.n },
    };
}

export function buildCanvasAgentTextConfig(config: AiConfig): AiConfig {
    const profile = getAgentTextApiProfile(useStore.getState().settings);
    if (!profile) return config;
    return {
        ...config,
        model: profile.model,
        textModel: profile.model,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        apiFormat: "openai",
        galleryTextProfileId: profile.id,
    };
}

export async function requestCanvasGalleryImages(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, signal?: AbortSignal) {
    if (!config.galleryImageProfileId || !config.galleryImageParams) return null;
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const state = useStore.getState();
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const settings = settingsForProfile(state.settings, config.galleryImageProfileId, config.model);
    const normalizedParams = normalizeParamsForSettings({ ...config.galleryImageParams, n: count }, settings, { hasInputImages: references.length > 0 });
    const transparent = normalizedParams.output_format === "png" && normalizedParams.transparent_output;
    const inputImageDataUrls = await Promise.all(references.map((reference) => imageToDataUrl(reference, signal)));
    const maskDataUrl = mask ? await imageToDataUrl(mask, signal) : undefined;
    signal?.throwIfAborted();
    const result = await callImageApi({
        settings,
        prompt: transparent ? createTransparentOutputMeta(prompt).effectivePrompt : prompt,
        params: transparent ? getTransparentRequestParams(normalizedParams) : { ...normalizedParams, transparent_output: false },
        inputImageDataUrls,
        maskDataUrl,
        signal,
    });
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const images = await Promise.all(result.images.map(async (dataUrl, index) => {
        const id = `${config.galleryImageProfileId}-${index}`;
        if (!transparent) return { id, dataUrl };
        try {
            return { id, dataUrl: await removeKeyedBackgroundFromDataUrl(dataUrl), originalDataUrl: dataUrl };
        } catch (error) {
            console.warn("透明后处理失败，保留生成原图", error);
            useStore.getState().showToast("透明后处理失败，已保留生成原图", "info");
            return { id, dataUrl };
        }
    }));
    signal?.throwIfAborted();
    return images;
}
