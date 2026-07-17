import { useEffect, useRef, useState, type ReactNode } from "react";

interface LibraryVirtualGridProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  resetKey: string;
  rowHeight?: number;
}

const DEFAULT_ROW_HEIGHT = 136;
const OVERSCAN_ROWS = 3;

export function LibraryVirtualGrid<T>({ items, itemKey, renderItem, resetKey, rowHeight = DEFAULT_ROW_HEIGHT }: LibraryVirtualGridProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(520);
  const rowCount = Math.ceil(items.length / 2);
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN_ROWS);
  const visible = items.slice(startRow * 2, endRow * 2);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setHeight(viewport.clientHeight));
    observer.observe(viewport);
    setHeight(viewport.clientHeight);
    return () => observer.disconnect();
  }, []);

  return <div className="library-virtual-viewport" ref={viewportRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div style={{ height: rowCount * rowHeight, position: "relative" }}>
      <div className="library-grid library-virtual-grid" style={{ position: "absolute", top: startRow * rowHeight, left: 0, right: 0 }}>
        {visible.map((item) => <div key={itemKey(item)} className="library-virtual-card">{renderItem(item)}</div>)}
      </div>
    </div>
  </div>;
}
