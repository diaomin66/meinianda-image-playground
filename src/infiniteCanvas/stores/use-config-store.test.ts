import { describe, expect, it } from "vitest";

import { defaultConfig } from "./use-config-store";

describe("canvas image defaults", () => {
    it("starts image generation at 1024x1024 with one output", () => {
        expect(defaultConfig.size).toBe("1024x1024");
        expect(defaultConfig.count).toBe("1");
        expect(defaultConfig.canvasImageCount).toBe("1");
    });
});
