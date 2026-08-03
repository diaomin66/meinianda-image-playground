import InfiniteCanvasModule from '../infiniteCanvas/InfiniteCanvasModule'

export default function InfiniteCanvasWorkspace() {
  return (
    <main className="canvas-app-workspace flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <InfiniteCanvasModule />
    </main>
  )
}
