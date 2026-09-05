/**
 * Every page must RENDER.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Three crashes reached the browser in this app, and all three were invisible to
 * every check that existed:
 *
 *   ReferenceError: Cannot access 'depTpl' before initialization   (a TDZ — a
 *     const used two lines above its own declaration)
 *   <Icon> is not defined  ×2  (an unused-vars rename that broke JSX usage)
 *
 * `vite build` compiled all three happily, because they are RUNTIME errors.
 * eslint missed them too (`no-use-before-define` is off, and enabling it yields
 * 38 mostly-false positives on deferred arrow consts). The only thing that
 * catches this class of bug is actually rendering the component.
 *
 * ── WHAT THIS DELIBERATELY DOES *NOT* DO ────────────────────────────────────
 * It asserts almost nothing about content. This is a SMOKE test: it answers "did
 * the module evaluate and the component mount without throwing?" and stops
 * there. Assertions about what a page displays belong in per-page tests written
 * against that page's contract; putting them here would make the file fragile in
 * exactly the way that gets a test suite deleted.
 *
 * Network is stubbed at the axios boundary so a page failing for a REAL reason
 * still fails loudly, while a page merely lacking a backend does not.
 */
import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── network: resolve everything with an empty-but-plausible payload ─────────
// `data` is an ARRAY, not `{}`. Most of this app's GETs return collections and
// call `.map` on the result directly; handing them an object turns a healthy
// page into a fake failure and teaches everyone to ignore this suite. An array
// satisfies the list consumers, and object consumers read `data.foo` as
// undefined — which every page here already guards, because a field can always
// be missing from a real response too.
vi.mock('axios', () => {
    const empty = () => Promise.resolve({ data: [] });
    const api = {
        get: vi.fn(empty), post: vi.fn(empty), put: vi.fn(empty),
        delete: vi.fn(empty), patch: vi.fn(empty),
        defaults: { headers: { common: {} }, withCredentials: true },
        interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
    };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

// socket.io opens a real connection otherwise
vi.mock('socket.io-client', () => ({
    io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: false }),
    default: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: false }),
}));

// lightweight-charts drives a real canvas; jsdom has no layout engine, so the
// chart component is exercised by its own contract, not by this smoke pass.
vi.mock('lightweight-charts', () => {
    const series = {
        setData: vi.fn(), createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn(), applyOptions: vi.fn(),
        // v5 plugin API — PriceChart attaches its trend-line primitive here.
        attachPrimitive: vi.fn(), detachPrimitive: vi.fn(),
        priceToCoordinate: vi.fn(() => 100), coordinateToPrice: vi.fn(() => 24000),
    };
    const chart = {
        addSeries: vi.fn(() => series),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        timeScale: vi.fn(() => ({
            fitContent: vi.fn(), setVisibleRange: vi.fn(),
            getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })), setVisibleLogicalRange: vi.fn(),
            timeToCoordinate: vi.fn(() => 50),
        })),
        applyOptions: vi.fn(), subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(), remove: vi.fn(),
        subscribeClick: vi.fn(), unsubscribeClick: vi.fn(),
    };
    return {
        createChart: vi.fn(() => chart),
        createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
        CandlestickSeries: 'Candlestick', HistogramSeries: 'Histogram',
        CrosshairMode: { Normal: 0 }, ColorType: { Solid: 'solid' },
        LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    };
});

// Pull the route table from the app's own config so a page added to the rail is
// covered automatically — a list maintained by hand here would drift the first
// time someone adds a page, which is precisely when this test matters most.
import { NAV_ITEMS, HIDDEN_ROUTES } from '../config/nav.js';
import { AuthProvider } from '../context/AuthContext';
import { GlobalProvider } from '../context/GlobalContext';
import ThemeProvider from '../theme/ThemeContext.jsx';
import ConfirmProvider from '../components/ConfirmDialog.jsx';

const PAGES = [...NAV_ITEMS, ...HIDDEN_ROUTES].filter(p => p.component);

/**
 * The REAL provider stack, in App.jsx's own order.
 *
 * Rendering a page bare is not a weaker test — it is a WRONG one: Backtest and
 * Optimizer both destructure `useGlobalState()`, so without GlobalProvider they
 * throw a TypeError that has nothing to do with the page's own correctness, and
 * would train everyone to ignore this file. Using the same providers the app
 * uses means a failure here is always about the page.
 */
/**
 * Catch a render throw the way React itself surfaces it.
 *
 * The first version of this file hooked `process.on('unhandledRejection')`,
 * which used Node globals in a browser-targeted lint config AND raced the
 * assertion — it reported 16 passes while two pages were visibly throwing. An
 * error boundary is the idiomatic answer: it sees every throw from the subtree
 * synchronously, before the test asserts.
 */
class Boundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { this.props.onError?.(String(error?.message || error)); }
    render() { return this.state.error ? <div data-testid="render-error">{String(this.state.error.message || this.state.error)}</div> : this.props.children; }
}

function Harness({ children, onError }) {
    return (
        <MemoryRouter initialEntries={['/']}>
            <ThemeProvider>
                <AuthProvider>
                    <ConfirmProvider>
                        <GlobalProvider>
                            <Boundary onError={onError}>
                                <Suspense fallback={<div>loading</div>}>{children}</Suspense>
                            </Boundary>
                        </GlobalProvider>
                    </ConfirmProvider>
                </AuthProvider>
            </ThemeProvider>
        </MemoryRouter>
    );
}

describe('every routed page mounts without throwing', () => {
    let errors;
    let unhandled;
    beforeEach(() => {
        errors = [];
        // Filled by the error boundary below — see its comment for why a
        // process-level hook was the wrong tool here.
        unhandled = [];
        // React reports a render throw through console.error before the error
        // boundary sees it; capturing it turns a silent pass into a failure.
        vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.join(' ')); });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    for (const page of PAGES) {
        it(`${page.path} renders`, async () => {
            const Page = page.component;
            render(<Harness onError={(m) => unhandled.push(m)}><Page /></Harness>);
            // Lazy pages resolve a dynamic import; wait for the fallback to go.
            await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument(), { timeout: 15000 });

            // A TDZ or an undefined component surfaces here, as a real throw.
            const fatal = [...errors, ...unhandled].filter(e =>
                /Cannot access .* before initialization/.test(e)
                || /is not defined/.test(e)
                || /is not a function/.test(e)
                || /Cannot read propert(y|ies)/.test(e)
                || /Element type is invalid/.test(e)
                || /Cannot destructure/.test(e));
            expect(fatal, `${page.path} threw during render:\n${fatal.join('\n')}`).toEqual([]);
        });
    }
});
