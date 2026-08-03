import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button, InputNumber, Modal, Select, Switch } from "antd";

import { imageQualityLabel, imageSizeLabel } from "@canvas/components/image-settings-panel";
import { getCanvasOverlayHost } from "@canvas/lib/overlay-host";
import { createCanvasImageParamsPatch, getCanvasGalleryImageModel, getCanvasGalleryImageParams, getCanvasGalleryImageProfile, getCanvasGalleryModelOptions } from "@canvas/lib/gallery-image-bridge";
import { useStore } from "../../../store";
import { normalizeSettings } from "../../../lib/apiProfiles";
import { normalizeParamsForSettings } from "../../../lib/paramCompatibility";
import { GEMINI_FLASH_ASPECT_RATIOS, GEMINI_FLASH_IMAGE_MODEL, GEMINI_FLASH_IMAGE_SIZES, GEMINI_PRO_IMAGE_SIZES, GEMINI_STANDARD_ASPECT_RATIOS } from "../../../lib/imageModels";
import SizePickerModal from "../../../components/SizePickerModal";
import { Select as CanvasSelect, SelectContent, SelectItem, SelectTrigger } from "@canvas/components/ui/select";
import type { CanvasNodeMetadata } from "@canvas/types/canvas";
import type { TaskParams } from "../../../types";

type CanvasGalleryImageControlsProps = {
    metadata?: CanvasNodeMetadata;
    onConfigChange: (patch: Partial<CanvasNodeMetadata>) => void;
    buttonClassName?: string;
    className?: string;
    hasInputImages?: boolean;
    onOpenChange?: (open: boolean) => void;
};

export function CanvasGalleryImageModelPicker({ metadata, onConfigChange, className }: Pick<CanvasGalleryImageControlsProps, "metadata" | "onConfigChange" | "className">) {
    const settings = useStore((state) => state.settings);
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => getCanvasGalleryModelOptions(settings), [settings]);
    const profile = getCanvasGalleryImageProfile(settings, metadata?.imageProfileId);
    const selected = options.find((option) => option.profileId === profile.id && option.model === (metadata?.model || profile.model)) || options.find((option) => option.profileId === profile.id && option.model === profile.model) || options[0];

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("canvas-image-control-open", closeOtherPicker);
        return () => window.removeEventListener("canvas-image-control-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <CanvasSelect open={open} value={selected?.value || ""} onOpenChange={(nextOpen) => {
            if (nextOpen) window.dispatchEvent(new CustomEvent("canvas-image-control-open", { detail: pickerId }));
            setOpen(nextOpen);
        }} onValueChange={(value) => {
            const next = options.find((option) => option.value === value);
            if (!next) return;
            onConfigChange({ imageProfileId: next.profileId, model: next.model });
        }}>
            <SelectTrigger className={`canvas-composer-model-picker h-10 w-full min-w-0 justify-start rounded-xl border border-input bg-transparent px-3 text-sm shadow-sm ${className || ""}`} title={selected?.label || "\u9009\u62e9\u6a21\u578b"} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <span className="min-w-0 flex-1 truncate text-left">{selected?.label || "\u9009\u62e9\u6a21\u578b"}</span>
            </SelectTrigger>
            <SelectContent data-canvas-no-zoom className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl" position="popper" align="start" side="bottom" sideOffset={6} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                {options.map((option) => <SelectItem key={option.value} value={option.value} textValue={option.label}><span className="block truncate">{option.label}</span></SelectItem>)}
            </SelectContent>
        </CanvasSelect>
    );
}

export function CanvasGalleryImageSettingsPopover({ metadata, onConfigChange, buttonClassName, hasInputImages = false, onOpenChange }: CanvasGalleryImageControlsProps) {
    const settings = useStore((state) => state.settings);
    const dialogId = useId();
    const [dialogView, setDialogView] = useState<"closed" | "settings" | "size">("closed");
    const open = dialogView === "settings";
    const sizePickerOpen = dialogView === "size";
    const profile = getCanvasGalleryImageProfile(settings, metadata?.imageProfileId);
    const model = getCanvasGalleryImageModel(settings, profile.id, metadata?.model);
    const profileSettings = useMemo(() => normalizeSettings({
        ...settings,
        activeProfileId: profile.id,
        profiles: settings.profiles.map((item) => item.id === profile.id ? { ...item, model } : item),
    }), [model, profile.id, settings]);
    const normalizedParams = normalizeParamsForSettings(getCanvasGalleryImageParams(metadata, profile.id, hasInputImages), profileSettings, { hasInputImages });
    const isGemini = profile.provider === "gemini";
    const isFal = profile.provider === "fal";
    const isGeminiFlash = model === GEMINI_FLASH_IMAGE_MODEL;

    useEffect(() => {
        const closeOtherSettings = (event: Event) => {
            if ((event as CustomEvent<string>).detail === dialogId || dialogView === "closed") return;
            setDialogView("closed");
            onOpenChange?.(false);
        };
        window.addEventListener("canvas-image-control-open", closeOtherSettings);
        return () => window.removeEventListener("canvas-image-control-open", closeOtherSettings);
    }, [dialogId, dialogView, onOpenChange]);

    const updateDialogView = (nextView: "closed" | "settings" | "size") => {
        if (nextView === dialogView) return;
        const wasOpen = dialogView !== "closed";
        const nextOpen = nextView !== "closed";
        if (!wasOpen && nextOpen) window.dispatchEvent(new CustomEvent("canvas-image-control-open", { detail: dialogId }));
        setDialogView(nextView);
        if (wasOpen !== nextOpen) onOpenChange?.(nextOpen);
    };
    const closeSizePicker = () => {
        updateDialogView("settings");
    };
    const updateParams = (patch: Partial<TaskParams>) => {
        const next = normalizeParamsForSettings({ ...normalizedParams, ...patch }, profileSettings, { hasInputImages });
        onConfigChange({ ...createCanvasImageParamsPatch(metadata, next), imageProfileId: profile.id, model });
    };
    const label = `${imageSizeLabel(normalizedParams.size)} · ${imageQualityLabel(normalizedParams.quality)} · ${normalizedParams.n} 张`;

    return (
        <>
            <Button size="small" type="text" className={`!border !border-input !bg-transparent !text-sm !font-normal !shadow-sm hover:!bg-muted ${buttonClassName || "!h-10 !max-w-[180px] !justify-start !rounded-xl !px-3"}`} icon={<Settings2 className="size-3.5" />} disabled={sizePickerOpen} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                event.stopPropagation();
                updateDialogView("settings");
            }}><span className="min-w-0 truncate">{label}</span></Button>
            <Modal
                getContainer={getCanvasOverlayHost}
                title="生图参数"
                open={open}
                onCancel={() => updateDialogView("closed")}
                footer={null}
                centered
                width={760}
                destroyOnHidden
                modalRender={(node) => (
                    <div
                        data-canvas-no-zoom
                        data-no-drag-select
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        {node}
                    </div>
                )}
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm"><span>尺寸</span><Button className="w-full !justify-start" onClick={() => {
                        updateDialogView("size");
                    }}>{isGemini ? `${normalizedParams.size} · ${normalizedParams.aspect_ratio}` : normalizedParams.size}</Button></label>
                    <label className="space-y-1.5 text-sm"><span>数量</span><InputNumber className="w-full" min={1} max={isFal ? 4 : 10} value={normalizedParams.n} onChange={(value) => updateParams({ n: Number(value) || 1 })} /></label>
                    {!isGemini && <label className="space-y-1.5 text-sm"><span>质量</span><Select className="w-full" value={normalizedParams.quality} disabled={profile.codexCli} options={(isFal ? ["low", "medium", "high"] : ["auto", "low", "medium", "high"]).map((value) => ({ value, label: value }))} onChange={(value) => updateParams({ quality: value })} /></label>}
                    {isGeminiFlash && <label className="space-y-1.5 text-sm"><span>思考</span><Select className="w-full" value={normalizedParams.thinking_level} options={["minimal", "high"].map((value) => ({ value, label: value }))} onChange={(value) => updateParams({ thinking_level: value })} /></label>}
                    <label className="space-y-1.5 text-sm"><span>输出格式</span><Select className="w-full" value={normalizedParams.output_format} options={(isGemini ? ["png", "jpeg"] : ["png", "jpeg", "webp"]).map((value) => ({ value, label: value.toUpperCase() }))} onChange={(value) => updateParams({ output_format: value })} /></label>
                    {!isGemini && <label className="space-y-1.5 text-sm"><span>背景</span><Select className="w-full" value={normalizedParams.background} disabled={normalizedParams.output_format === "jpeg"} options={["auto", "opaque", "transparent"].map((value) => ({ value, label: value }))} onChange={(value) => updateParams({ background: value })} /></label>}
                    {!isGemini && !isFal && <label className="space-y-1.5 text-sm"><span>压缩率</span><InputNumber className="w-full" min={0} max={100} disabled={normalizedParams.output_format === "png"} value={normalizedParams.output_compression} placeholder="0-100" onChange={(value) => updateParams({ output_compression: typeof value === "number" ? value : null })} /></label>}
                    {!isGemini && !isFal && <label className="space-y-1.5 text-sm"><span>审核</span><Select className="w-full" value={normalizedParams.moderation} options={["auto", "low"].map((value) => ({ value, label: value }))} onChange={(value) => updateParams({ moderation: value })} /></label>}
                    {!isGemini && <div className="flex items-center justify-between rounded-xl border px-3 py-2 sm:col-span-2"><span className="text-sm">透明输出增强</span><Switch checked={normalizedParams.transparent_output} disabled={normalizedParams.output_format !== "png"} onChange={(checked) => updateParams({ transparent_output: checked })} /></div>}
                </div>
            </Modal>
            {sizePickerOpen ? createPortal(
                <div
                    data-canvas-no-zoom
                    data-no-drag-select
                    className="fixed inset-0 pointer-events-auto"
                    style={{ zIndex: 1300 }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <SizePickerModal currentSize={normalizedParams.size} allowAuto={!isFal || hasInputImages} codexCli={profile.codexCli} {...(isGemini ? { gemini: { currentAspectRatio: normalizedParams.aspect_ratio, imageSizes: isGeminiFlash ? GEMINI_FLASH_IMAGE_SIZES : GEMINI_PRO_IMAGE_SIZES, aspectRatios: isGeminiFlash ? GEMINI_FLASH_ASPECT_RATIOS : GEMINI_STANDARD_ASPECT_RATIOS } } : {})} onSelect={(size, aspectRatio) => {
                        updateParams({ size, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) });
                        closeSizePicker();
                    }} onClose={closeSizePicker} />
                </div>,
                getCanvasOverlayHost(),
            ) : null}
        </>
    );
}
