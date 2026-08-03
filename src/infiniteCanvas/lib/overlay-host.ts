let overlayHost: HTMLElement | null = null

export function setCanvasOverlayHost(host: HTMLElement | null) {
  overlayHost = host
}

export function getCanvasOverlayHost() {
  return overlayHost || document.body
}
