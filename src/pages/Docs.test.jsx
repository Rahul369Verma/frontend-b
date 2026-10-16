/**
 * Docs page — the reading experience: the article renders with its breadcrumb
 * and sections; search is driven entirely from the keyboard (type, ↓, Enter
 * lands on the section); the glossary filters; shortcuts move between pages;
 * contents groups fold; an unknown page says so instead of going blank.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Docs from './Docs.jsx';
import { DOC_PAGES, getDocPage } from '../docs/index.js';

function Where() {
    const loc = useLocation();
    return <div data-testid="where">{loc.pathname}{loc.hash}</div>;
}

function renderAt(path) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/docs" element={<><Docs /><Where /></>} />
                <Route path="/docs/:pageId" element={<><Docs /><Where /></>} />
            </Routes>
        </MemoryRouter>,
    );
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* none */ }
});

describe('Docs page', () => {
    it('renders a page with breadcrumb, reading time and every section', () => {
        renderAt('/docs/dashboard');
        const page = getDocPage('dashboard');
        expect(screen.getByRole('heading', { level: 2, name: page.title })).toBeTruthy();
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Watch what is running');
        expect(screen.getByText(/min read/)).toBeTruthy();
        for (const s of page.sections) expect(document.getElementById(`doc-${s.id}`)).toBeTruthy();
    });

    it('search: type, move with ↓, open with Enter — lands on that section', () => {
        renderAt('/docs/start');
        const box = screen.getByRole('searchbox', { name: 'Search the documentation' });
        fireEvent.change(box, { target: { value: 'probe' } });
        const results = screen.getByRole('list', { name: 'Search results' });
        const links = within(results).getAllByRole('link');
        expect(links.length).toBeGreaterThan(1);
        expect(results.querySelector('mark')).toBeTruthy();
        fireEvent.keyDown(box, { key: 'ArrowDown' });
        const second = links[1].getAttribute('href');
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(where()).toBe(second);
        expect(box.value).toBe('');
    });

    it('search with no match says so', () => {
        renderAt('/docs/start');
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search the documentation' }), { target: { value: 'zzqqxx' } });
        expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    });

    it('glossary: the filter narrows the terms and the A–Z bar jumps', () => {
        renderAt('/docs/glossary');
        const all = getDocPage('glossary').sections.length;
        expect(screen.getByRole('navigation', { name: 'Jump to letter' })).toBeTruthy();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Filter glossary terms' }), { target: { value: 'vwap' } });
        const shown = document.querySelectorAll('section[data-doc-section]').length;
        expect(shown).toBeGreaterThan(0);
        expect(shown).toBeLessThan(all);
        expect(screen.getByText(new RegExp(`of ${all} terms match`))).toBeTruthy();
    });

    it('keyboard: ] and [ move between pages, ? lists the shortcuts', () => {
        renderAt('/docs/start');
        fireEvent.keyDown(window, { key: ']' });
        expect(where()).toBe(`/docs/${DOC_PAGES[1].id}`);
        fireEvent.keyDown(window, { key: '[' });
        expect(where()).toBe(`/docs/${DOC_PAGES[0].id}`);
        fireEvent.keyDown(window, { key: '?' });
        expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    });

    it('shortcuts are ignored while typing in a field', () => {
        renderAt('/docs/start');
        const box = screen.getByRole('searchbox', { name: 'Search the documentation' });
        fireEvent.keyDown(box, { key: ']' });
        expect(where()).toBe('/docs/start');
    });

    it('contents: a group without the open page folds and unfolds', () => {
        renderAt('/docs/start');
        const nav = screen.getByRole('navigation', { name: 'Documentation contents' });
        const btn = within(nav).getByRole('button', { name: /Research/ });
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(btn);
        expect(btn.getAttribute('aria-expanded')).toBe('false');
        expect(within(nav).queryByRole('link', { name: 'Backtest' })).toBeNull();
        fireEvent.click(btn);
        expect(within(nav).getByRole('link', { name: 'Backtest' })).toBeTruthy();
    });

    it('the group holding the open page cannot be folded away', () => {
        renderAt('/docs/backtest');
        const nav = screen.getByRole('navigation', { name: 'Documentation contents' });
        const btn = within(nav).getByRole('button', { name: /Research/ });
        expect(btn.disabled).toBe(true);
        expect(within(nav).getByRole('link', { name: 'Backtest' }).getAttribute('aria-current')).toBe('page');
    });

    it('an unknown page says so and shows the first page', () => {
        renderAt('/docs/no-such-page');
        expect(screen.getByText(/There is no doc page called “no-such-page”/)).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: DOC_PAGES[0].title })).toBeTruthy();
    });

    it('doc links carry their target for hover previews', () => {
        renderAt('/docs/dashboard');
        const link = document.querySelector('a[data-doc-target]');
        expect(link).toBeTruthy();
        expect(link.getAttribute('data-doc-target')).toMatch(/^[a-z-]+(#[a-z0-9-]+)?$/);
    });
});
