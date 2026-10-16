/**
 * Re-orderable columns: the order maths, drag-and-drop between headers, the
 * keyboard grip, the Columns menu, and that the order survives a reload and
 * copes with a column that is only sometimes shown.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, createEvent, within } from '@testing-library/react';
import useColumnOrder, { useColumnDrag, mergeOrder, moveKey, stepKey } from './useColumnOrder.js';
import ReorderableTh from '../components/table/ReorderableTh.jsx';
import ColumnOrderMenu from '../components/table/ColumnOrderMenu.jsx';

describe('order maths', () => {
    it('mergeOrder keeps a remembered order, drops unknown keys, slots new ones after their default neighbour', () => {
        expect(mergeOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
        expect(mergeOrder(['c', 'zz', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
        // 'gate' is new today: it goes right after 'reason', where it sits by default
        expect(mergeOrder(['pnl', 'reason', 'chart'], ['chart', 'pnl', 'reason', 'gate'])).toEqual(['pnl', 'reason', 'gate', 'chart']);
        expect(mergeOrder(null, ['a', 'b'])).toEqual(['a', 'b']);
        expect(mergeOrder(['a', 'a', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
    });

    it('moveKey drops before / after the target; no-ops are safe', () => {
        expect(moveKey(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
        expect(moveKey(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
        expect(moveKey(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
        expect(moveKey(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
    });

    it('stepKey nudges one place and stops at the ends', () => {
        expect(stepKey(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
        expect(stepKey(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
        expect(stepKey(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
        expect(stepKey(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    });
});

const KEYS = ['chart', 'entry_time', 'symbol', 'pnl', 'reason'];
const LABEL = { chart: 'Chart', entry_time: 'Entry Time', symbol: 'Symbol', pnl: 'P&L', reason: 'Reason' };

function Table({ keys = KEYS }) {
    const cols = useColumnOrder('test:cols', keys);
    const dnd = useColumnDrag(cols.move);
    return (
        <>
            <ColumnOrderMenu columns={cols.order.map(k => ({ key: k, label: LABEL[k] || k }))} onStep={cols.step} onReset={cols.reset} isCustom={cols.isCustom} />
            <table>
                <thead><tr>{cols.order.map(k => <ReorderableTh key={k} colKey={k} label={LABEL[k] || k} dnd={dnd} onStep={cols.step}>{LABEL[k] || k}</ReorderableTh>)}</tr></thead>
                <tbody><tr>{cols.order.map(k => <td key={k}>{`${k}-cell`}</td>)}</tr></tbody>
            </table>
        </>
    );
}

const headerOrder = () => screen.getAllByRole('columnheader').map(th => th.textContent);
const cellOrder = () => screen.getAllByRole('cell').map(td => td.textContent.replace('-cell', ''));

/** jsdom has no layout: give every header a 100px box so left/right halves exist. */
function boxHeaders() {
    screen.getAllByRole('columnheader').forEach((th, i) => {
        th.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, width: 100, top: 0, bottom: 20, height: 20 });
    });
}

function drag(fromText, toText, side) {
    boxHeaders();
    const from = screen.getByRole('columnheader', { name: new RegExp(fromText) });
    const to = screen.getByRole('columnheader', { name: new RegExp(toText) });
    const r = to.getBoundingClientRect();
    const clientX = side === 'after' ? r.left + 90 : r.left + 10;
    const dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
    // jsdom has no DragEvent, so clientX would be dropped — set it on the event itself.
    const at = (ev) => { Object.defineProperty(ev, 'clientX', { value: clientX }); return ev; };
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent(to, at(createEvent.dragOver(to, { dataTransfer })));
    fireEvent(to, at(createEvent.drop(to, { dataTransfer })));
    fireEvent.dragEnd(from, { dataTransfer });
}

beforeEach(() => { try { window.localStorage.clear(); } catch { /* none */ } });

describe('drag a header', () => {
    it('drops a column before the target (left half) and the cells follow', () => {
        render(<Table />);
        drag('P&L', 'Entry Time', 'before');
        expect(headerOrder()).toEqual(['Chart', 'P&L', 'Entry Time', 'Symbol', 'Reason']);
        expect(cellOrder()).toEqual(['chart', 'pnl', 'entry_time', 'symbol', 'reason']);
    });

    it('drops after the target (right half)', () => {
        render(<Table />);
        drag('Chart', 'Reason', 'after');
        expect(headerOrder()).toEqual(['Entry Time', 'Symbol', 'P&L', 'Reason', 'Chart']);
    });

    it('remembers the order across a reload', () => {
        const { unmount } = render(<Table />);
        drag('Reason', 'Chart', 'before');
        unmount();
        render(<Table />);
        expect(headerOrder()).toEqual(['Reason', 'Chart', 'Entry Time', 'Symbol', 'P&L']);
    });

    it('a sometimes-shown column comes back where it was', () => {
        const { unmount } = render(<Table keys={[...KEYS, 'gate']} />);
        drag('gate', 'Chart', 'before');
        unmount();
        const { unmount: u2 } = render(<Table />);              // a run without the gate
        expect(headerOrder()).toEqual(['Chart', 'Entry Time', 'Symbol', 'P&L', 'Reason']);
        u2();
        render(<Table keys={[...KEYS, 'gate']} />);              // gate back
        expect(headerOrder()[0]).toBe('gate');
    });
});

describe('keyboard and menu', () => {
    it('the grip moves its column with ← / →', () => {
        render(<Table />);
        const grip = screen.getByRole('button', { name: 'Move column Symbol (left and right arrow keys)' });
        fireEvent.keyDown(grip, { key: 'ArrowRight' });
        expect(headerOrder()).toEqual(['Chart', 'Entry Time', 'P&L', 'Symbol', 'Reason']);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Move column Symbol (left and right arrow keys)' }), { key: 'ArrowLeft' });
        expect(headerOrder()).toEqual(KEYS.map(k => LABEL[k]));
    });

    it('the Columns menu moves columns and resets', () => {
        render(<Table />);
        fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
        const menu = screen.getByRole('dialog', { name: 'Column order' });
        expect(within(menu).getByRole('button', { name: 'Move Chart left' }).disabled).toBe(true);
        fireEvent.click(within(menu).getByRole('button', { name: 'Move Reason left' }));
        expect(headerOrder()).toEqual(['Chart', 'Entry Time', 'Symbol', 'Reason', 'P&L']);
        expect(screen.getByRole('button', { name: /Columns •/ })).toBeTruthy();
        fireEvent.click(within(menu).getByRole('button', { name: /Reset to default order/ }));
        expect(headerOrder()).toEqual(KEYS.map(k => LABEL[k]));
    });
});
