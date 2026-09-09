export type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

// 请求属于项目，切换工作区后仍需接收结果，并支持重新进入时停止。
const projectRequests = new Map<string, Map<string, CanvasGenerationRequest>>();
const deletedTargets = new WeakMap<AbortSignal, Set<string>>();

export function getDeletedGenerationTargets(signal: AbortSignal) {
    let targets = deletedTargets.get(signal);
    if (!targets) {
        targets = new Set();
        deletedTargets.set(signal, targets);
    }
    return targets;
}

export function getCanvasGenerationRequests(projectId: string) {
    let requests = projectRequests.get(projectId);
    if (!requests) {
        requests = new Map();
        projectRequests.set(projectId, requests);
    }
    return requests;
}

export function cancelCanvasGenerationRequests(projectId: string) {
    projectRequests.get(projectId)?.forEach((request) => request.controller.abort());
    projectRequests.delete(projectId);
}
