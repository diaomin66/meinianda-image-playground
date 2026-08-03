import { Button } from "antd";
import { Bot } from "lucide-react";

import { getAgentTextApiProfile } from "../../../lib/apiProfiles";
import { useStore } from "../../../store";

export function CanvasAgentModelButton({ className }: { className?: string }) {
    const settings = useStore((state) => state.settings);
    const profile = getAgentTextApiProfile(settings);

    return (
        <Button
            size="small"
            type="text"
            className={`!border !border-input !bg-muted/60 hover:!bg-muted ${className || "!h-10 !max-w-[190px] !justify-start !rounded-full !px-3"}`}
            icon={<Bot className="size-3.5" />}
            onClick={() => useStore.getState().setShowSettings(true, "agent")}
            title={profile?.model || "配置全局 Agent 模型"}
        >
            <span className="truncate">{profile?.model || "配置 Agent 模型"}</span>
        </Button>
    );
}
