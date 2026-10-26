/**
 * The ↗ after a strategy's name opens the SAME results page in a new tab (user, 23-Oct-2026),
 * and never triggers the row it sits in.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewTabLink, { NameWithNewTab } from './NewTabLink.jsx';

describe('NewTabLink', () => {
    it('is a real new-tab link to the same page, named for screen readers', () => {
        render(<NewTabLink href="/multi-leg?tab=results&deployment=abc" label="nifty-core (PAPER)" />);
        const a = screen.getByRole('link', { name: "Open nifty-core (PAPER)'s results in a new tab" });
        expect(a.getAttribute('href')).toBe('/multi-leg?tab=results&deployment=abc');
        expect(a.getAttribute('target')).toBe('_blank');
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    });
    it('does not trigger its row, and draws nothing without an address', () => {
        const onRow = vi.fn();
        render(<div onClick={onRow}><NewTabLink href="/x" label="s" /></div>);
        fireEvent.click(screen.getByRole('link'));
        expect(onRow).not.toHaveBeenCalled();
        const { container } = render(<NewTabLink href={null} label="s" />);
        expect(container.innerHTML).toBe('');
    });
    it('NameWithNewTab keeps the name and its icon on one line', () => {
        render(<NameWithNewTab href="/y" label="hedged-condor"><a href="/y">hedged-condor</a></NameWithNewTab>);
        expect(screen.getAllByRole('link').map((l) => l.getAttribute('target'))).toEqual([null, '_blank']);
    });
});
