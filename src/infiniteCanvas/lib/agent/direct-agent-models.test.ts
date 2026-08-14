import { describe, expect, it } from "vitest";

import { DIRECT_AGENT_MODEL_OPTIONS, getDirectAgentModel, getDirectAgentReasoningEffort, getDirectAgentReasoningEfforts } from "./direct-agent-models";

describe("direct canvas agent model options", () => {
    it("exposes the six built-in Codex models", () => {
        expect(DIRECT_AGENT_MODEL_OPTIONS.map((option) => option.value)).toEqual([
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4-mini",
            "gpt-5.4",
        ]);
    });

    it("only exposes max for the gpt-5.6 family", () => {
        expect(getDirectAgentReasoningEfforts("gpt-5.6-sol")).toContain("max");
        expect(getDirectAgentReasoningEfforts("gpt-5.6-terra")).toContain("max");
        expect(getDirectAgentReasoningEfforts("gpt-5.6-luna")).toContain("max");
        expect(getDirectAgentReasoningEfforts("gpt-5.5")).not.toContain("max");
        expect(getDirectAgentReasoningEfforts("gpt-5.4-mini")).not.toContain("max");
        expect(getDirectAgentReasoningEfforts("gpt-5.4")).not.toContain("max");
    });

    it("falls back to a supported effort when switching models", () => {
        expect(getDirectAgentReasoningEffort("gpt-5.5", "max")).toBe("medium");
        expect(getDirectAgentReasoningEffort("gpt-5.6-sol", "max")).toBe("max");
        expect(getDirectAgentModel("unknown-model")).toBe("gpt-5.6-sol");
    });
});
