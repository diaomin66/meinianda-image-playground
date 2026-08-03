export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#ffffff",
            dot: "rgba(113,113,122,.24)",
            line: "rgba(113,113,122,.10)",
            selectionStroke: "#2563eb",
            selectionFill: "rgba(37,99,235,.08)",
        },
        node: {
            label: "#52525b",
            fill: "#f4f4f5",
            panel: "#ffffff",
            stroke: "#e4e4e7",
            activeStroke: "#2563eb",
            placeholder: "#a1a1aa",
            text: "#18181b",
            muted: "#71717a",
            faint: "#a1a1aa",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#e4e4e7",
            item: "#52525b",
            itemHover: "#f4f4f5",
            activeBg: "#f4f4f5",
            activeText: "#18181b",
        },
    },
    dark: {
        canvas: {
            background: "#09090b",
            dot: "rgba(161,161,170,.24)",
            line: "rgba(161,161,170,.10)",
            selectionStroke: "#3b82f6",
            selectionFill: "rgba(59,130,246,.12)",
        },
        node: {
            label: "#d4d4d8",
            fill: "#27272a",
            panel: "#18181b",
            stroke: "#3f3f46",
            activeStroke: "#3b82f6",
            placeholder: "#71717a",
            text: "#fafafa",
            muted: "#a1a1aa",
            faint: "#71717a",
        },
        toolbar: {
            panel: "rgba(24,24,27,.96)",
            border: "#3f3f46",
            item: "#d4d4d8",
            itemHover: "#27272a",
            activeBg: "#27272a",
            activeText: "#fafafa",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
