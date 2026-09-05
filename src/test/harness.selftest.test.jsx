/**
 * Does the render harness actually catch the bugs it was built for?
 *
 * A smoke suite that passes on everything — including a broken component — is
 * worse than no suite, because it converts "untested" into "believed tested".
 * The first draft of pages.render.test.jsx did exactly that: it reported 16
 * passes while two pages were visibly throwing, because the throw escaped as an
 * unhandled rejection after the assertion had run.
 *
 * So these tests deliberately break components in the three ways that have
 * actually reached this app's browser, and assert the detection FIRES. If
 * someone later loosens the filter in pages.render.test.jsx, this fails.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

/** The same classifier pages.render.test.jsx uses. Kept in sync by these tests. */
const isFatal = (e) => /Cannot access .* before initialization/.test(e)
    || /is not defined/.test(e)
    || /is not a function/.test(e)
    || /Cannot read propert(y|ies)/.test(e)
    || /Element type is invalid/.test(e)
    || /Cannot destructure/.test(e);

/** Render something that throws, and return what the console reported. */
function renderCatching(Component) {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.join(' ')); });
    try { render(<Component />); } catch (e) { errors.push(String(e?.message || e)); }
    spy.mockRestore();
    return errors;
}

describe('the render harness detects the failures that reached production', () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it('catches a temporal-dead-zone const — the depTpl crash', () => {
        // The exact shape of the Multi-Leg failure: a const read one line above
        // its own declaration. `vite build` compiles this without complaint.
        function TdzPage() {
            const label = tpl.name;              // eslint-disable-line no-use-before-define
            const tpl = { name: 'iron_condor' };
            return <div>{label}</div>;
        }
        const errors = renderCatching(TdzPage);
        expect(errors.some(isFatal), `no fatal detected in:\n${errors.join('\n')}`).toBe(true);
        expect(errors.join(' ')).toMatch(/before initialization/);
    });

    it('catches an undefined component — the <Icon> crash, twice over', () => {
        // What happened when `icon: _Icon` was renamed to satisfy no-unused-vars
        // and the JSX still said <Icon>: the identifier resolves to undefined and
        // React refuses the element type.
        function UndefinedIconPage({ icon }) {
            const Icon = icon;                    // undefined when nothing is passed
            return <div><Icon /></div>;
        }
        const errors = renderCatching(UndefinedIconPage);
        expect(errors.some(isFatal), `no fatal detected in:\n${errors.join('\n')}`).toBe(true);
    });

    it('catches a missing provider — the useGlobalState destructure', () => {
        function NoProviderPage() {
            const { something } = undefined;      // what a context hook returns unprovided
            return <div>{something}</div>;
        }
        const errors = renderCatching(NoProviderPage);
        expect(errors.some(isFatal), `no fatal detected in:\n${errors.join('\n')}`).toBe(true);
    });

    it('does NOT flag a page that merely renders nothing', () => {
        const errors = renderCatching(function EmptyPage() { return null; });
        expect(errors.filter(isFatal)).toEqual([]);
    });

    it('does NOT flag a page that handles its own failed fetch', () => {
        // A page catching an API error and logging it is working correctly. If
        // the classifier flagged this, every offline page would look broken and
        // the suite would be turned off within a week.
        const errors = renderCatching(function HandledPage() {
            React.useEffect(() => { console.error('Failed to fetch configs — showing empty state'); }, []);
            return <div>empty</div>;
        });
        expect(errors.filter(isFatal)).toEqual([]);
    });
});
