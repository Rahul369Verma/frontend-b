import React, { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Card, Panel, CollapseAllControl, PageHeader } from './primitives.jsx';
import CollapsibleCard from '../CollapsibleCard.jsx';
import useCollapse, { deriveFoldKey, setAllFolded } from '../../hooks/useCollapse.js';

// Every long panel on the platform folds (user, 16-Oct-2026): Card/Panel/
// CollapsibleCard and the hand-built toggles share ONE hook, so they remember
// themselves the same way and all answer "Collapse all / Expand all".

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const toggle = (name) => screen.getByRole('button', { name: new RegExp(name) });

describe('foldable Card / Panel', () => {
    beforeEach(() => { localStorage.clear(); });

    it('a titled card folds behind its heading button; the body unmounts', () => {
        wrap(<Card title="Market regime & structure fit" subtitle="pure maths"><p>body text</p></Card>);
        const btn = toggle('Market regime');
        expect(btn).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('heading', { name: /Market regime/ })).toContainElement(btn);   // WAI-ARIA accordion: <h2><button>
        expect(screen.getByText('body text')).toBeInTheDocument();
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('body text')).toBeNull();
        expect(screen.getByText('pure maths')).toBeInTheDocument();   // the subtitle stays as the folded summary
    });

    it('remembers its state across a remount', () => {
        const { unmount } = wrap(<Panel title="Deployments (3)" docs="multi-leg#deploy-toolbar"><p>rows</p></Panel>);
        fireEvent.click(toggle('Deployments'));
        unmount();
        wrap(<Panel title="Deployments (4)" docs="multi-leg#deploy-toolbar"><p>rows</p></Panel>);   // count changed — same panel
        expect(screen.queryByText('rows')).toBeNull();
        expect(toggle('Deployments')).toHaveAttribute('aria-expanded', 'false');
    });

    it('defaultOpen=false starts folded; summary shows only while folded', () => {
        wrap(<Card title="Signals" defaultOpen={false} summary="3 entry · 2 wait"><p>ribbon</p></Card>);
        expect(screen.getByText('3 entry · 2 wait')).toBeInTheDocument();
        fireEvent.click(toggle('Signals'));
        expect(screen.getByText('ribbon')).toBeInTheDocument();
        expect(screen.queryByText('3 entry · 2 wait')).toBeNull();
    });

    it('collapsible={false} and untitled cards never fold', () => {
        wrap(<>
            <Card collapsible={false} title="Portfolio unavailable"><p>err</p></Card>
            <Card right={<span>x</span>}><p>plain</p></Card>
        </>);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByText('err')).toBeInTheDocument();
        expect(screen.getByText('plain')).toBeInTheDocument();
    });

    it('header controls (right, titleAfter, docs) sit OUTSIDE the toggle — no button in a button', () => {
        wrap(<Panel title="Legs" titleAfter={<button type="button">help</button>} docs="multi-leg#builder-tab"
            right={<button type="button">+ leg</button>}><p>legs</p></Panel>);
        const btn = toggle('^Legs$');
        expect(btn).not.toContainElement(screen.getByRole('button', { name: 'help' }));
        expect(btn).not.toContainElement(screen.getByRole('button', { name: '+ leg' }));
        fireEvent.click(btn);
        expect(screen.getByRole('button', { name: '+ leg' })).toBeInTheDocument();   // controls stay usable while folded
    });

    it('controlled: the owner holds the state (e.g. to pause a poll while folded)', () => {
        function Owner() {
            const [open, setOpen] = useState(true);
            return <><span>owner says {String(open)}</span><Card title="Engine events" open={open} onOpenChange={setOpen}><p>events</p></Card></>;
        }
        wrap(<Owner />);
        fireEvent.click(toggle('Engine events'));
        expect(screen.getByText('owner says false')).toBeInTheDocument();
        expect(screen.queryByText('events')).toBeNull();
    });
});

describe('Collapse all / Expand all', () => {
    beforeEach(() => { localStorage.clear(); });

    function HandBuilt() {
        const { open, toggle: t } = useCollapse({ storageKey: 'fold:test|hand', defaultOpen: false });
        return <button type="button" aria-expanded={open} onClick={t}>hand-built</button>;
    }

    it('reaches Card, Panel, CollapsibleCard and hand-built toggles alike — and is remembered', () => {
        wrap(<>
            <PageHeader title="Multi-Leg" foldAll />
            <Card title="One"><p>one</p></Card>
            <Panel title="Two" defaultOpen={false}><p>two</p></Panel>
            <CollapsibleCard title="Three" storageKey="dash:three"><p>three</p></CollapsibleCard>
            <HandBuilt />
        </>);
        fireEvent.click(screen.getByRole('button', { name: /Expand all/ }));
        for (const t of ['one', 'two', 'three']) expect(screen.getByText(t)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'hand-built' })).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(screen.getByRole('button', { name: /Collapse all/ }));
        for (const t of ['one', 'two', 'three']) expect(screen.queryByText(t)).toBeNull();
        expect(screen.getByRole('button', { name: 'hand-built' })).toHaveAttribute('aria-expanded', 'false');
        expect(localStorage.getItem('dash:three')).toBe('0');            // CollapsibleCard keeps its old key format
        expect(localStorage.getItem('fold:test|hand')).toBe('0');
    });

    it('setAllFolded works without the control (e.g. a keyboard shortcut later)', () => {
        render(<CollapseAllControl />);
        wrap(<Card title="Solo"><p>solo</p></Card>);
        act(() => setAllFolded(false));
        expect(screen.queryByText('solo')).toBeNull();
    });
});

describe('deriveFoldKey', () => {
    it('masks numbers, keys by page + docs + title text', () => {
        const a = deriveFoldKey({ docs: 'multi-leg#results-tab', title: <>Structure round-trips ({42})</> });
        const b = deriveFoldKey({ docs: 'multi-leg#results-tab', title: 'Structure round-trips (1,234)' });
        expect(a).toBe(b);
        expect(a).toMatch(/^fold:.*\|multi-leg#results-tab\|Structure round-trips \(#\)$/);
        expect(deriveFoldKey({ docs: null, title: null })).toBeNull();
    });
});
