'use strict';
/**
 * nav.js — the application's page map, as DATA.
 *
 * THE EXTENSIBILITY CONTRACT
 * Adding a page is appending ONE object to NAV_ITEMS. Nothing in `App.jsx`
 * changes: it renders the rail by mapping NAV_ITEMS and the <Route> table from
 * the same array, so the link and the route can no longer disagree — which is
 * the actual failure mode this replaces (a nav entry pointing at a path with no
 * route renders a blank <main> and looks like a broken page).
 *
 * SHAPE OF AN ENTRY
 *   path       the route path, and the href of the rail link
 *   icon       a lucide-react component (NOT an element) — the rail sizes it
 *   labelKey   dotted path into `src/config/strings.js`; the rail calls
 *              t(labelKey). Deliberately a key and not a string: this file is
 *              structure, wording lives in the catalog, and a missing key
 *              renders visibly rather than blank.
 *   component  the routed page component
 *
 * WHY THE ICONS ARE IMPORTED HERE
 * They are part of the entry, not of the rail. Keeping the imports next to the
 * data means a new page's icon is chosen in the same edit as its path and label,
 * and `App.jsx` imports no icon at all for navigation. lucide-react is a single
 * ES module of tree-shakeable named exports, so importing them here rather than
 * in App.jsx makes no difference to the bundle.
 *
 * ORDER IS THE RAIL ORDER — top to bottom, most-used first. Dashboard leads;
 * Settings is last by convention.
 */
import {
    Activity,
    Brain,
    Gauge,
    CandlestickChart,
    LayoutDashboard,
    Layers,
    LineChart,
    Settings,
    ShieldCheck,
    Square,
    Terminal,
    Timer,
    Wallet,
    Zap,
} from 'lucide-react';

import { lazy } from 'react';

/*
 * PAGES ARE LAZY, and that is a bundle decision made here because this is where
 * the page map lives.
 *
 * Every page used to be a static import, so all twelve shipped in one chunk:
 * ~1,037 kB of JS before anything rendered, including Backtest (4,018 lines),
 * MultiLeg (3,150), Dashboard (2,334) and TickStrategies (2,122) — roughly
 * 11,600 lines of code delivered to someone who opened Settings. Vite gives each
 * dynamic import its own chunk, so a page is now fetched when it is first
 * visited and cached from then on.
 *
 * `<Suspense>` in App.jsx is what makes this safe: without a boundary above the
 * routes, a lazy element suspends with nowhere to land and React throws. The two
 * are a pair — do not make a page lazy without checking that fallback is still
 * there.
 *
 * Note these are the same component identity on every render (module-scope
 * consts), which is what lets React keep a page mounted across re-renders. A
 * lazy() call inside a component would remount the page on every parent render.
 */
const Dashboard = lazy(() => import('../pages/Dashboard'));
const Backtest = lazy(() => import('../pages/Backtest'));
const Optimizer = lazy(() => import('../pages/Optimizer'));
const MultiLeg = lazy(() => import('../pages/MultiLeg'));
const Risk = lazy(() => import('../pages/Risk'));
const Charts = lazy(() => import('../pages/Charts'));
const LivePortfolio = lazy(() => import('../pages/LivePortfolio'));
const TickStrategies = lazy(() => import('../pages/TickStrategies'));
const TickResults = lazy(() => import('../pages/TickResults'));
const SettingsPage = lazy(() => import('../pages/Settings'));
const StrategyDetail = lazy(() => import('../pages/StrategyDetail'));
const Callback = lazy(() => import('../pages/Callback'));
const AiManager = lazy(() => import('../components/AiManager'));
const AiScore = lazy(() => import('../pages/AiScore'));
const DataManager = lazy(() => import('../components/DataManager'));
const ParityAuditDashboard = lazy(() => import('../components/ParityAuditDashboard'));

/** The sidebar rail, in order. Twelve entries, one per navigable page. */
export const NAV_ITEMS = [
    { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', component: Dashboard },
    // Sits directly under Dashboard: Dashboard is "what is running right now",
    // this is "what has it all made" — the same book, one zoom level out.
    { path: '/live-portfolio', icon: Wallet, labelKey: 'nav.livePortfolio', component: LivePortfolio },
    // Sits next to the portfolio: that page says what happened, this one shows
    // WHERE it happened — the same trades, drawn on price.
    { path: '/charts', icon: CandlestickChart, labelKey: 'nav.charts', component: Charts },
    { path: '/backtest', icon: LineChart, labelKey: 'nav.backtest', component: Backtest },
    { path: '/optimizer', icon: Activity, labelKey: 'nav.optimizer', component: Optimizer },
    { path: '/multi-leg', icon: Layers, labelKey: 'nav.multiLeg', component: MultiLeg },
    { path: '/risk', icon: Gauge, labelKey: 'nav.risk', component: Risk },
    { path: '/tick-strategies', icon: Zap, labelKey: 'nav.tickStrategies', component: TickStrategies },
    // Sits directly under the tick control room, for the same reason Live
    // Portfolio sits under Dashboard: one is "what is running", the other is
    // "what has it earned".
    { path: '/tick-results', icon: Timer, labelKey: 'nav.tickResults', component: TickResults },
    { path: '/ai-manager', icon: Terminal, labelKey: 'nav.aiManager', component: AiManager },
    // Sits next to the AI control room for the same reason results sit next to
    // engines: that page runs the AI, this one says whether it has been worth it.
    { path: '/ai-score', icon: Brain, labelKey: 'nav.aiScore', component: AiScore },
    { path: '/parity-audit', icon: ShieldCheck, labelKey: 'nav.parityAudit', component: ParityAuditDashboard },
    { path: '/data-manager', icon: Square, labelKey: 'nav.dataManager', component: DataManager },
    { path: '/settings', icon: Settings, labelKey: 'nav.settings', component: SettingsPage },
];

/**
 * Routed pages that are deliberately NOT in the rail: reached from a link inside
 * another page, or by the broker redirecting back to us. Same shape (minus the
 * icon, which nothing would draw) so `App.jsx` can concatenate the two lists and
 * build one <Route> table — a page that lives only here is still added in one
 * object, in this file.
 */
export const HIDDEN_ROUTES = [
    { path: '/strategy/:symbol', labelKey: 'nav.strategyDetail', component: StrategyDetail },
    { path: '/callback', labelKey: 'nav.callback', component: Callback },
];

/** Everything that gets a <Route>. Rail order first, then the unlisted pages. */
export const ALL_ROUTES = [...NAV_ITEMS, ...HIDDEN_ROUTES];

export default NAV_ITEMS;
