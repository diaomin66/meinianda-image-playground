import type { CanvasProject } from "@canvas/stores/canvas/use-canvas-store";
import type { StoredDirectAgentConversation } from "@canvas/services/agent-chat-storage";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
    agentConversations?: StoredDirectAgentConversation[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
