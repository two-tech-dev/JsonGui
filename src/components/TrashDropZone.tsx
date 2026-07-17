import type { DragEvent } from "react";
import { Trash2 } from "lucide-react";

interface TrashDropZoneProps {
  active: boolean;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
}

export function TrashDropZone({ active, onDrop, onDragOver, onDragLeave }: TrashDropZoneProps) {
  return <div className={`trash-drop-zone ${active ? "active" : ""}`} role="region" aria-label="Kéo item đã đặt vào đây để xóa" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <Trash2 size={16} />
    <span>{active ? "Thả để xóa item" : "Kéo item vào đây để xóa"}</span>
  </div>;
}
