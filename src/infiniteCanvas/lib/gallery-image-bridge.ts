import { callImageApi } from "../../lib/api";
import { getActiveApiProfile, getAgentTextApiProfile, normalizeSettings } from "../../lib/apiProfiles";
import { FIXED_GEMINI_PROFILE_ID, FIXED_IMAGE_PROFILE_ID } from "../../lib/fixedApiProfiles";
import { GEMINI_FLASH_IMAGE_MODEL, GEMINI_PRO_IMAGE_MODEL, GPT_IMAGE_MODEL } from "../../lib/imageModels";
import { getChangedParams, normalizeParamsForSettings } from "../../lib/paramCompatibility";
import { useStore } from "../../store";
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
        if (profile.id === FIXED_IMAGE_PROFILE_ID) return [{ value: `${profile.id}:${GPT_IMAGE_MODEL}`, profileId: profile.id, model: GPT_IMAGE_MODEL, label: GPT_IMAGE_MODEL }];
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
    return { ...state.params, ...legacyImageParams(metadata), ...metadata?.imageParams };
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
    const result = await callImageApi({
        settings,
        prompt,
        params: normalizeParamsForSettings({ ...config.galleryImageParams, n: count }, settings, { hasInputImages: references.length > 0 }),
        inputImageDataUrls: references.map((reference) => reference.dataUrl),
        ...(mask?.dataUrl ? { maskDataUrl: mask.dataUrl } : {}),
    });
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    return result.images.map((dataUrl, index) => ({ id: `${config.galleryImageProfileId}-${index}`, dataUrl }));
}
