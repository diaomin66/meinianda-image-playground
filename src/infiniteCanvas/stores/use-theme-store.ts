import { create } from "zustand";

export type ThemeName = "light" | "dark";

function systemTheme(): ThemeName {
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

type ThemeStore = {
    theme: ThemeName;
};

export const useThemeStore = create<ThemeStore>()(() => ({ theme: systemTheme() }));
