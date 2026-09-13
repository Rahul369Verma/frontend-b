/**
 * Toast — the behaviours that make it a real replacement for alert().
 * alert() blocked the page, ignored all twelve themes, and could not be copied
 * from. What replaces it has to be at least as reliable at getting a message in
 * front of someone, without any of that.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Toaster from './Toast.jsx';
import { toast, snapshot } from './toastStore.js';

describe('toast store', () => {
    beforeEach(() => { toast.clear(); });

    it('records a message with its level', () => {
        toast.error('order rejected');
        expect(snapshot()).toHaveLength(1);
        expect(snapshot()[0]).toMatchObject({ level: 'error', text: 'order rejected' });
    });

    it('accepts an Error object — call sites pass err directly', () => {
        toast.error(new Error('broker timeout'));
        expect(snapshot()[0].text).toBe('broker timeout');
    });

    it('ignores empty messages instead of showing a blank box', () => {
        toast.info('');
        toast.info(null);
        toast.info('   ');
        expect(snapshot()).toHaveLength(0);
    });

    it('COLLAPSES duplicates rather than stacking them', () => {
        // A retry loop firing the same failure must not bury the rest of the UI.
        for (let i = 0; i < 5; i++) toast.error('same failure');
        expect(snapshot()).toHaveLength(1);
        expect(snapshot()[0].count).toBe(5);
    });

    it('caps the queue so a burst cannot fill the viewport', () => {
        for (let i = 0; i < 20; i++) toast.error(`distinct failure ${i}`);
        expect(snapshot().length).toBeLessThanOrEqual(5);
        // the newest survive — an old error is less useful than the current one
        expect(snapshot()[snapshot().length - 1].text).toBe('distinct failure 19');
    });

    it('gives errors longer on screen than successes', () => {
        toast.success('saved');
        toast.error('failed');
        const [ok, err] = snapshot();
        expect(err.ms).toBeGreaterThan(ok.ms);
    });
});

describe('Toaster rendering', () => {
    beforeEach(() => { toast.clear(); });
    afterEach(() => { vi.useRealTimers(); });

    it('renders the message and announces it politely', () => {
        render(<Toaster />);
        act(() => { toast.error('margin shortfall'); });
        expect(screen.getAllByText(/margin shortfall/).length).toBeGreaterThan(0);
        const region = screen.getByRole('region', { name: /notifications/i });
        expect(region.querySelector('[aria-live="polite"]')).toBeTruthy();
    });

    it('every toast is dismissible by keyboard', () => {
        render(<Toaster />);
        act(() => { toast.info('heads up'); });
        expect(screen.getByRole('button', { name: /dismiss notification/i })).toBeTruthy();
    });

    it('auto-dismisses after its lifetime', () => {
        vi.useFakeTimers();
        render(<Toaster />);
        act(() => { toast.success('done', { ms: 1000 }); });
        expect(snapshot()).toHaveLength(1);
        act(() => { vi.advanceTimersByTime(1500); });
        expect(snapshot()).toHaveLength(0);
    });
});
