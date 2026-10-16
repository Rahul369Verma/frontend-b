/**
 * ReorderableTh — a table header cell you can drag left or right to move its
 * column (see useColumnOrder / useColumnDrag). A line on the cell's left or
 * right edge shows where the column will land; the column being dragged fades.
 *
 * Keyboard: the grip is a button — focus it and press ← / → to move the column
 * one place. Touch screens have no HTML5 drag, so tables also offer the
 * ColumnOrderMenu.
 */
import React from 'react';
import { GripVertical } from 'lucide-react';

export default function ReorderableTh({ colKey, label, dnd, onStep, className = '', title, children }) {
    const { drag, over, thProps } = dnd;
    const landing = over && over.key === colKey && drag !== colKey ? over.side : null;
    return (
        <th {...thProps(colKey)} title={title}
            className={`${className} group/th relative select-none cursor-grab active:cursor-grabbing ${drag === colKey ? 'opacity-40' : ''}`}>
            {landing && (
                <span aria-hidden="true"
                    className={`absolute top-1 bottom-1 w-0.5 rounded bg-primary ${landing === 'before' ? 'left-0' : 'right-0'}`} />
            )}
            <span className="inline-flex items-center gap-1">
                <button type="button" tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(colKey, -1); }
                        else if (e.key === 'ArrowRight') { e.preventDefault(); onStep(colKey, 1); }
                    }}
                    title="Drag to move this column, or focus and use ← →"
                    aria-label={`Move column ${label} (left and right arrow keys)`}
                    className="-ml-1 text-fg-5 opacity-30 group-hover/th:opacity-100 focus-visible:opacity-100 cursor-grab">
                    <GripVertical className="w-3 h-3" aria-hidden="true" />
                </button>
                {children}
            </span>
        </th>
    );
}
