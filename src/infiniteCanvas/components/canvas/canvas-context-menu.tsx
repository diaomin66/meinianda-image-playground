import { useEffect } from "react";
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { ContextMenuState } from "@canvas/types/canvas";

export function CanvasNodeContextMenu({ menu, closing, onClose, onDuplicate, onDelete }: { menu: ContextMenuState; closing: boolean; onClose: () => void; onDuplicate: () => void; onDelete: () => void }) {

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="menu-surface menu-motion fixed z-[80] w-44 overflow-hidden p-1.5"
            data-closing={closing}
            inert={closing}
            style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 184)), top: Math.max(8, Math.min(menu.y, window.innerHeight - (menu.type === 'node' ? 108 : 64))) }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label="复制" onClick={onDuplicate} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    return (
        <button type="button" className="menu-item flex w-full items-center gap-3 px-3 py-2 text-left text-xs" data-variant={danger ? "danger" : undefined} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
