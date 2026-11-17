/**
 * FitVisibleWidth (18-Nov-2026): an expanded row inside a table wider than its scrolling panel is
 * sized to the panel's VISIBLE width and pinned to its left edge, so a chart in it is never drawn
 * off screen.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FitVisibleWidth from './FitVisibleWidth.jsx';

const RO = globalThis.ResizeObserver;
afterEach(() => { globalThis.ResizeObserver = RO; });

describe('FitVisibleWidth', () => {
    it('takes the scrolling panel\'s visible width, less the cell padding, and sticks to its left edge', () => {
        globalThis.ResizeObserver = class { observe() {} disconnect() {} };
        const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.dataset.w ? Number(this.dataset.w) : 0; } });
        try {
            render(
                <div data-w="800" style={{ overflowX: 'auto' }}>
                    <table style={{ width: 2000 }}><tbody><tr><td colSpan={17} style={{ paddingLeft: '8px', paddingRight: '8px' }}>
                        <FitVisibleWidth><span>chart</span></FitVisibleWidth>
                    </td></tr></tbody></table>
                </div>,
            );
            const el = screen.getByTestId('fit-visible-width');
            expect(el.style.width).toBe('784px');
            expect(el.className).toMatch(/sticky left-0/);
        } finally {
            if (proto) Object.defineProperty(HTMLElement.prototype, 'clientWidth', proto);
        }
    });

    it('without a scrolling panel (or ResizeObserver) it is a plain block', () => {
        globalThis.ResizeObserver = undefined;
        render(<FitVisibleWidth><span>x</span></FitVisibleWidth>);
        expect(screen.getByTestId('fit-visible-width').style.width).toBe('');
    });
});
