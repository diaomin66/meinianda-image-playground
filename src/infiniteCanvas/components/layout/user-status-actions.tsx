import type { CSSProperties } from "react";
import { Keyboard, Puzzle } from "lucide-react";

import { GitHubLink } from "@canvas/components/layout/github-link";
import { VersionReleaseModal } from "@canvas/components/layout/version-release-modal";
import { cn } from "@canvas/lib/utils";
import { canvasThemes } from "@canvas/lib/canvas-theme";
import { useThemeStore } from "@canvas/stores/use-theme-store";

type UserStatusActionsProps = {
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label="节点插件" title="节点插件">
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            {variant === "default" ? (
                <>
                    <VersionReleaseModal />
                    <GitHubLink className={cn("size-7 bg-transparent text-base hover:bg-transparent dark:hover:bg-transparent")} />
                </>
            ) : null}
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
