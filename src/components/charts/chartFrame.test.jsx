/**
 * The one chart frame (ZoomableChart): window/domain arithmetic, the recharts-3
 * string index (a second zoom used to compute 5 + "3" = "53"), keyboard zoom and pan,
 * the navigator, full screen and the CSV export.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act, within } from '@testing-library/react';
import { LineChart, Line, XAxis, YAxis } from 'recharts';
import ZoomableChart from './ZoomableChart.jsx';
import { useChartZoom, clampWindow, zoomWindow, panWindow, indexOf } from './useChartZoom.jsx';
import { zoomDomain, panDomain, pxToValue, fracAcross, rowsToCsv, fileStem, numericDomain } from './chartFrameMath.js';

const rows = Array.from({ length: 20 }, (_, i) => ({ i, v: i * 10, label: `d${i}` }));

describe('window arithmetic (index mode)', () => {
    it('clamps, keeps a minimum width, and reads "not zoomed" for the whole series', () => {
        expect(clampWindow(3, 9, 20)).toEqual([3, 9]);
        expect(clampWindow(9, 3, 20)).toEqual([3, 9]);
        expect(clampWindow(0, 19, 20)).toBeNull();
        expect(clampWindow(5, 5, 20)).toEqual([3, 6]);
        expect(indexOf('3')).toBe(3);
        expect(indexOf(null)).toBeNull();
    });
    it('zooms about the anchor and pans against the ends', () => {
        const w = zoomWindow(null, 100, 0.5, 0.25);      // zoom in on the first quarter
        expect(w[1] - w[0] + 1).toBe(50);
        expect(w[0]).toBeLessThanOrEqual(25);
        expect(w[1]).toBeGreaterThanOrEqual(25);
        expect(panWindow([10, 19], 20, 5)).toEqual([10, 19]);
        expect(panWindow([5, 14], 20, -10)).toEqual([0, 9]);
    });
});

describe('domain arithmetic (xy mode)', () => {
    it('zooms about a point, never past the full range, and pans inside it', () => {
        expect(zoomDomain([0, 100], 0.5, 0.5)).toEqual([25, 75]);
        expect(zoomDomain([0, 100], 0.5, 0)).toEqual([0, 50]);
        expect(zoomDomain([20, 60], 4, 0.5, [0, 100])).toBeNull();          // out past everything = reset
        expect(panDomain([0, 50], 0.2, [0, 100])).toEqual([10, 60]);
        expect(panDomain([60, 100], 0.5, [0, 100])).toEqual([60, 100]);
        expect(pxToValue(150, 50, 200, [0, 100])).toBe(50);
        expect(pxToValue(50, 50, 200, [0, 100], true)).toBe(100);
        expect(fracAcross(100, 50, 100)).toBe(0.5);
        expect(numericDomain(['a', 'b'])).toBeNull();
        expect(numericDomain([1, 5])).toEqual([1, 5]);
    });
    it('CSV keeps the plain columns and quotes what needs it; file names are tidy', () => {
        const csv = rowsToCsv([{ a: 1, b: 'x,y', c: { nested: 1 }, _k: 0 }, { a: 2, b: 'say "hi"' }]);
        expect(csv.split('\n')).toEqual(['a,b', '1,"x,y"', '2,"say ""hi"""']);
        expect(fileStem('Structure — Short Straddle')).toBe('structure-short-straddle');
        expect(fileStem('')).toBe('chart');
    });
});

describe('useChartZoom', () => {
    it('a second drag-zoom inside a zoomed chart lands where it was dragged (recharts 3 gives string indexes)', () => {
        const { result } = renderHook(() => useChartZoom(rows));
        const drag = (a, b) => {
            act(() => result.current.chartProps.onMouseDown({ activeTooltipIndex: String(a), activeLabel: `L${a}` }));
            act(() => result.current.chartProps.onMouseMove({ activeTooltipIndex: String(b), activeLabel: `L${b}` }));
            act(() => result.current.chartProps.onMouseUp());
        };
        drag(2, 12);
        expect(result.current.range).toEqual([2, 12]);
        drag(1, 6);                                       // inside the zoomed view: points 3..8
        expect(result.current.range).toEqual([3, 8]);
        expect(result.current.view.map((r) => r.i)).toEqual([3, 4, 5, 6, 7, 8]);
    });
});

const Chart = (props) => (
    <ZoomableChart data={rows} height={200} title="Equity — test" {...props}>
        <LineChart><XAxis dataKey="label" /><YAxis /><Line dataKey="v" name="value" /></LineChart>
    </ZoomableChart>
);

describe('ZoomableChart', () => {
    it('keys zoom, pan and reset; a zoomed chart shows the navigator', () => {
        render(<Chart />);
        const frame = screen.getByTestId('chart-frame');
        expect(screen.getByText('20 pts')).toBeInTheDocument();
        expect(screen.queryByTestId('chart-navigator')).toBeNull();
        fireEvent.keyDown(frame, { key: '+' });
        expect(screen.getByText('12/20')).toBeInTheDocument();
        expect(screen.getByTestId('chart-navigator')).toBeInTheDocument();
        const slider = screen.getByRole('slider', { name: 'Visible part of the chart' });
        const before = slider.getAttribute('aria-valuenow');
        fireEvent.keyDown(frame, { key: 'ArrowRight' });
        expect(screen.getByRole('slider', { name: 'Visible part of the chart' }).getAttribute('aria-valuenow')).not.toBe(before);
        fireEvent.keyDown(frame, { key: '0' });
        expect(screen.getByText('20 pts')).toBeInTheDocument();
    });

    it('the toolbar zooms and resets; F opens full screen with the zoom carried over', () => {
        render(<Chart />);
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        expect(screen.getByText('12/20')).toBeInTheDocument();
        fireEvent.keyDown(screen.getByTestId('chart-frame'), { key: 'f' });
        const dialog = screen.getByRole('dialog', { name: 'Equity — test' });
        expect(within(dialog).getByText('12/20')).toBeInTheDocument();
        expect(screen.getByText(/Shown in full screen/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Leave full screen' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
        expect(screen.getByText('20 pts')).toBeInTheDocument();
    });

    it('CSV downloads the points shown', async () => {
        const blobs = [];
        URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:x'; });
        URL.revokeObjectURL = vi.fn();
        render(<Chart />);
        fireEvent.keyDown(screen.getByTestId('chart-frame'), { key: '+' });
        fireEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
        const text = await blobs[0].text();
        const lines = text.split('\n');
        expect(lines[0]).toBe('i,v,label');
        expect(lines.length).toBe(1 + 12);
    });
});
