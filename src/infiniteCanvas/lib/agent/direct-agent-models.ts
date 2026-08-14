import type { ReasoningEffort } from "../../../types";

const FULL_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ReasoningEffort[];
const STANDARD_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const satisfies readonly ReasoningEffort[];

export const DIRECT_AGENT_MODEL_OPTIONS = [
    { value: "gpt-5.6-sol", reasoningEfforts: FULL_REASONING_EFFORTS },
    { value: "gpt-5.6-terra", reasoningEfforts: FULL_REASONING_EFFORTS },
    { value: "gpt-5.6-luna", reasoningEfforts: FULL_REASONING_EFFORTS },
    { value: "gpt-5.5", reasoningEfforts: STANDARD_REASONING_EFFORTS },
    { value: "gpt-5.4-mini", reasoningEfforts: STANDARD_REASONING_EFFORTS },
    { value: "gpt-5.4", reasoningEfforts: STANDARD_REASONING_EFFORTS },
] as const;

export type DirectAgentModel = typeof DIRECT_AGENT_MODEL_OPTIONS[number]["value"];

export const DIRECT_AGENT_REASONING_LABELS: Record<ReasoningEffort, string> = {
    none: "无",
    minimal: "最小",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最大",
};

export function getDirectAgentModel(model?: string): DirectAgentModel {
    return DIRECT_AGENT_MODEL_OPTIONS.some((option) => option.value === model) ? model as DirectAgentModel : DIRECT_AGENT_MODEL_OPTIONS[0].value;
}

export function getDirectAgentReasoningEfforts(model: string): readonly ReasoningEffort[] {
    return DIRECT_AGENT_MODEL_OPTIONS.find((option) => option.value === model)?.reasoningEfforts || DIRECT_AGENT_MODEL_OPTIONS[0].reasoningEfforts;
}

export function getDirectAgentReasoningEffort(model: string, effort?: ReasoningEffort): ReasoningEffort {
    const options = getDirectAgentReasoningEfforts(model);
    if (effort && (options as readonly string[]).includes(effort)) return effort;
    return options.includes("medium") ? "medium" : options[0];
}
