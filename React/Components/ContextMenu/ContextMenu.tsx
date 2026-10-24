import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

const ContextMenu = ({ x, y, items, onClose }: ContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const menu = menuRef.current;
        menu?.querySelector<HTMLButtonElement>("button")?.focus();

        const closeOnOutsideClick = (event: MouseEvent) => {
            if (event.target instanceof Node && !menu?.contains(event.target)) {
                onClose();
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };

        document.addEventListener("mousedown", closeOnOutsideClick);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("mousedown", closeOnOutsideClick);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="soundscapes-context-menu"
            role="menu"
            style={{ left: `${x}px`, top: `${y}px` }}
            onContextMenu={(event) => event.preventDefault()}
        >
            {items.map((item) => (
                <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                        item.onSelect();
                        onClose();
                    }}
                >
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
};

export default ContextMenu;
