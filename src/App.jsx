import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LogOut, Palette, PanelLeftClose, PanelLeftOpen, Shield, Terminal } from 'lucide-react';
import LoginPage from './pages/LoginPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GlobalProvider } from './context/GlobalContext';
import ThemeProvider from './theme/ThemeContext.jsx';
import ThemePanel from './theme/ThemePanel.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConfirmProvider from './components/ConfirmDialog.jsx';
import { pollInterval } from './hooks/usePolling.js';
import { ALL_ROUTES, NAV_ITEMS } from './config/nav.js';
import { useT } from './config/useT.js';
import { useConfirm } from './components/confirmContext.js';

/**
 * App shell — provider stack, sidebar rail and the route table.
 *
 * ── THREE THINGS THIS FILE NO LONGER OWNS ───────────────────────────────────
 *   1. the page list  -> src/config/nav.js     (NAV_ITEMS / ALL_ROUTES)
 *   2. the wording    -> src/config/strings.js (via t())
 *   3. the colours    -> src/theme/*           (semantic tokens only)
 *
 * The nav array and the <Route> table used to be two hand-maintained lists that
 * happened to agree; they are now the SAME array, so a rail link can no longer
 * point at a path with no route (which renders a blank <main> and reads as a
 * broken page rather than a missing route). Adding a page is one object in
 * nav.js — no edit here.
 *
 * ── WHY ThemeProvider IS THE OUTERMOST PROVIDER ─────────────────────────────
 * Above AuthProvider, deliberately. Everything AuthGate can render instead of
 * the app — the "checking session" splash and the whole LoginPage — has to be
 * themed too, and on a light theme an unthemed login screen is not a cosmetic
 * problem: it is white text on white. It also means the palette is resolved and
 * applied before any authenticated component mounts and starts painting.
 *
 * ── COLOUR RULE ─────────────────────────────────────────────────────────────
 * Semantic tokens only. The chrome in this file is the frame around all 12
 * themes, so a literal `slate-*` here is visible in ten of them.
 */

/** Keyboard-only ring, matching ThemePanel's. Mouse clicks leave no halo. */
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function Sidebar() {
  const t = useT();
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  // Collapsed state persisted to localStorage so it survives reload.
  // Defaults to COLLAPSED on first visit (no stored preference) to maximise
  // content width; once the user toggles, their choice is remembered.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem('sidebar:collapsed');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar:collapsed', next ? '1' : '0'); } catch { /* private mode: forget, do not throw */ }
      return next;
    });
  };

  // The appearance slide-over. State lives HERE, next to its trigger, rather
  // than in App: nothing else in the tree needs to know the panel is open, and
  // lifting it would make every route re-render on a theme-panel toggle.
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  return (
    /*
      `overflow-x-hidden overflow-y-auto` on the rail is the LAST-RESORT guarantee
      that the footer below (which owns the only Appearance trigger) can always be
      reached. The nav's own scroller handles the normal case; this handles the one
      it structurally cannot — when the header plus the footer plus the nav's own
      padding already exceed `h-screen`, the nav has nothing left to give and the
      footer gets pushed out regardless. Measured at 1280x400 / fontScale 1.60 the
      footer sat 92.1px below the fold and `scrollTop` would not move (an
      `overflow: visible` box reports a scrollHeight it will not actually scroll);
      with this it scrolls 92px and lands flush.

      overflow-x is pinned to `hidden` rather than left to default because setting
      overflow-y to a non-visible value forces overflow-x to `auto` too, which would
      raise a horizontal scrollbar on the rail for the 200ms the width transition
      spends narrower than the labels it is revealing.

      ThemePanel is `position: fixed` and overflow does not create a containing
      block, so it still anchors to the viewport — verified in the same harness
      (a fixed `right-0` child stayed at the viewport edge, not the rail's).
    */
    <div className={`${collapsed ? 'w-16' : 'w-64'} bg-card border-r border-line h-screen flex flex-col overflow-x-hidden overflow-y-auto transition-[width] duration-200`}>
      <div className="p-4 border-b border-line flex items-center justify-between gap-2">
        {!collapsed && (
          <h1 className="text-xl font-bold text-primary flex items-center gap-2">
            <Terminal className="w-6 h-6" />
            {t('app.name')}
          </h1>
        )}
        <button
          onClick={toggle}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-expanded={!collapsed}
          className={`text-fg-4 hover:text-fg hover:bg-fg/10 rounded p-2 transition-colors ml-auto ${FOCUS}`}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      {/* The rail IS NAV_ITEMS. No labels and no icons are named in this file. */}
      {/*
        `min-h-0 overflow-y-auto` is load-bearing, not tidiness. `flex-1` is
        `flex: 1 1 0%`, but a flex item's default `min-height: auto` floors it at
        CONTENT height, so the nav could only ever grow — never shrink — and the
        overflow was paid for by shoving the footer out of the `h-screen` column,
        where it painted outside the card background and off the bottom of the
        viewport. Measured (1280x800, 10 nav items): the footer sat 93px below the
        fold at fontScale 1.00 and 575px at 1.60. With these two classes the nav
        becomes the scroller and the spill is 0px at every scale.

        This is an accessibility failure, not a cosmetic one: the footer holds the
        Appearance button, the only route back to the theme panel app-wide, so a
        reader who raised the text size lost the control that would lower it again.

        The collapsed branch was immune only by accident — `overflow-x-hidden`
        promotes overflow-y to `auto` per CSS Overflow L3. Stating both explicitly
        means the behaviour no longer depends on that side effect, and the
        collapsed measurements are unchanged (spill 0px, same scrollHeight).
      */}
      <nav className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-2 ${collapsed ? 'overflow-x-hidden' : ''}`}>
        {NAV_ITEMS.map((item) => {
          const label = t(item.labelKey);
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              // Collapsed, the icon is the only affordance, so the label has to
              // survive as a tooltip AND as the accessible name.
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
              aria-current={isActive(item.path) ? 'page' : undefined}
              // `text-primary-ink`, not `text-primary`: the active pill paints the
              // brand hue at 10% over the card and then asks for the SAME hue as
              // ink, which is a fill being read as text. Measured on the shipped
              // palette that is 2.47:1 on nord, 2.61 nightshift, 2.73 abyss, 2.80
              // evergreen — and 4.03:1 on midnight itself, i.e. every theme fails
              // WCAG AA. `--color-primary-ink` is the same hue re-cut at the accent
              // INK role, which is what the token exists for; it takes midnight to
              // 6.59:1 and the worst of the twelve to 4.97:1.
              className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-3 rounded-lg transition-colors ${FOCUS} ${
                isActive(item.path)
                  ? 'bg-primary/10 text-primary-ink'
                  : 'text-fg-4 hover:bg-fg/10 hover:text-fg'
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="font-medium">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-line space-y-2">
        {/*
          Appearance. Deliberately in the footer rather than the rail: it is not
          a page, it does not change the route, and it must not read as one. The
          collapsed form is the icon alone with the label as tooltip + accessible
          name, which is the same contract the nav links use — so the panel is
          reachable in BOTH sidebar states, by mouse and by keyboard.
        */}
        <button
          type="button"
          onClick={() => setAppearanceOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={appearanceOpen}
          title={collapsed ? t('sidebar.appearance') : t('sidebar.appearanceTitle')}
          aria-label={t('sidebar.appearance')}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-3'} py-2 rounded-lg text-fg-4 hover:bg-fg/10 hover:text-fg transition-colors ${FOCUS}`}
        >
          <Palette className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="font-medium text-sm">{t('sidebar.appearance')}</span>}
        </button>

        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-4'} py-2 text-sm text-fg-4`}>
          <div
            className="w-2 h-2 rounded-full bg-success animate-pulse flex-shrink-0"
            title={collapsed ? t('sidebar.systemOnline') : undefined}
          />
          {!collapsed && <span>{t('sidebar.systemOnline')}</span>}
        </div>
        {!collapsed && <SessionFooter />}
      </div>

      {/*
        Mounted inside the sidebar so it sits next to the button that owns its
        state. Position is unaffected: the panel is `position: fixed` and no
        ancestor here creates a containing block (no transform, no filter, no
        `will-change`), so it anchors to the viewport either way.
      */}
      <ThemePanel open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </div>
  );
}

/**
 * SessionFooter — small block under the sidebar showing session expiry +
 * a logout button. Only renders when auth is actually on (not 'disabled').
 */
function SessionFooter() {
    const t = useT();
    const confirm = useConfirm();
    const { status, expiresAt, logout } = useAuth();
    // `Date.now()` read during render is impure: React may render at any time,
    // and the value it produces is not derived from props or state, so two
    // renders of the same inputs can disagree. It also meant the countdown was
    // only ever as fresh as the last unrelated re-render — it could sit at
    // "3h 20m" for an hour. A minute-ticking state value fixes both: the render
    // is a pure function of (expiresAt, now), and the label actually counts down.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const stop = pollInterval(() => setNow(Date.now()), 60000);
        return () => stop();
    }, []);
    if (status !== 'authenticated') return null;
    // Format "in 3 days" / "in 12 hours" / "in 45 min"
    let expiryStr = null;
    if (expiresAt) {
        const ms = new Date(expiresAt).getTime() - now;
        if (ms > 0) {
            const days  = Math.floor(ms / 86400000);
            const hours = Math.floor((ms % 86400000) / 3600000);
            const mins  = Math.floor((ms % 3600000) / 60000);
            if (days > 0)  expiryStr = `${days}d ${hours}h`;
            else if (hours > 0) expiryStr = `${hours}h ${mins}m`;
            else expiryStr = `${mins}m`;
        }
    }
    return (
        <button
            onClick={async () => { if (await confirm({ title: t('sidebar.logoutConfirm'), confirmLabel: t('sidebar.logout') })) logout(); }}
            className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-xs text-fg-5 hover:text-fg-2 hover:bg-fg/10 rounded transition ${FOCUS}`}
            title={t('sidebar.logoutTitle')}
        >
            <span className="flex items-center gap-2">
                <Shield className="w-3 h-3" />
                {expiryStr ? t('sidebar.session', { time: expiryStr }) : t('sidebar.sessionActive')}
            </span>
            <LogOut className="w-3 h-3" />
        </button>
    );
}

/**
 * AuthGate — wraps the routed app. While checking, shows a spinner. If
 * unauthenticated, shows LoginPage. Once authenticated (or when auth is
 * disabled server-side), shows the children.
 */
function AuthGate({ children }) {
    const t = useT();
    const { status } = useAuth();
    if (status === 'checking') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg text-fg-5 text-sm">
                <div className="flex items-center gap-2">
                    {/* Was bg-violet-500 — an arbitrary hue with no meaning. The
                        brand accent is the one colour guaranteed to be visible
                        and on-palette in every theme. */}
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    {t('auth.checking')}
                </div>
            </div>
        );
    }
    if (status === 'unauthenticated') return <LoginPage />;
    // 'authenticated' or 'disabled' → render the app
    return children;
}

/** Shown while a lazily-loaded page chunk is in flight. Deliberately quiet —
 *  a chunk fetch is usually a few milliseconds on a warm cache, and a big
 *  spinner flashing on every navigation reads as slower than nothing. */
function RouteFallback() {
    return (
        <div className="p-6 text-sm text-fg-5" role="status" aria-live="polite">
            Loading…
        </div>
    );
}

/** Per-route error boundary. Separated out so it can call useLocation() — the
 *  pathname is the reset key that lets navigation clear a caught error. */
function RouteBoundary({ route, children }) {
    const location = useLocation();
    const t = useT();
    return (
        <ErrorBoundary label={route.labelKey ? t(route.labelKey) : route.path} resetKey={location.pathname}>
            {children}
        </ErrorBoundary>
    );
}

function App() {
  // Handle malformed Fyers redirect (e.g. http://localhost:5173/s=ok&code=...)
  useEffect(() => {
    if (window.location.pathname.startsWith('/s=ok')) {
      const search = window.location.pathname.substring(1); // remove leading /
      // Redirect to settings with query params
      window.location.href = `/settings?${search}`;
    }
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <ConfirmProvider>
        <AuthGate>
          <GlobalProvider>
            <Router>
              {/*
                `h-screen overflow-hidden`, NOT `min-h-screen`. The rail is
                `position: static` and stays put by being a flex child of a box
                that is exactly the viewport tall — so the shell must not be
                allowed to grow. Under `min-h-screen` the container stretches to
                fit whatever the page renders, which leaves <main> with a
                content-driven height, which means its `overflow-auto` never has
                anything to overflow: the BODY scrolls instead, and the rail
                (h-screen, pinned to the top of a now-taller container) scrolls
                off with it. Bounding the shell to 100vh is what hands the
                scrolling to <main> and makes the rail hold.

                `min-w-0` on <main> is the companion guard: a flex item defaults
                to `min-width: auto`, so one wide table (MultiLeg and Backtest
                both have them) would refuse to shrink and squeeze the rail
                narrower instead of scrolling inside its own box.
              */}
              <div className="flex h-screen overflow-hidden bg-bg text-fg font-sans">
                <Sidebar />
                <main className="flex-1 min-w-0 overflow-auto">
                  {/*
                    One <Route> per entry in ALL_ROUTES (= the rail, then the
                    pages reached from inside another page or from the broker
                    redirect). React Router v6 ranks routes by specificity, not
                    by declaration order, so `/strategy/:symbol` and `/callback`
                    coming last is not a behavioural change from the hand-written
                    table this replaces.
                  */}
                  {/*
                    <Suspense> is REQUIRED, not optional: nav.js makes every page
                    a lazy() import, and a lazy element that suspends with no
                    boundary above it throws instead of waiting.
                  */}
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      {ALL_ROUTES.map((route) => (
                        // <route.component /> rather than a destructured `Page`:
                        // a dotted JSX name is always resolved as a component, and
                        // it avoids binding a local that this eslint config (no
                        // eslint-plugin-react, so JSX usage is not tracked) would
                        // report as an unused parameter.
                        //
                        // Each page gets its OWN ErrorBoundary rather than relying
                        // on the root one, so a page that throws is a broken PANEL
                        // and not a broken app: the rail, the theme panel and
                        // navigation all keep working, and you can leave the page
                        // that broke. `resetKey` is the pathname, so navigating
                        // away clears the error instead of pinning the fallback.
                        <Route
                          key={route.path}
                          path={route.path}
                          element={(
                            <RouteBoundary route={route}>
                              <route.component />
                            </RouteBoundary>
                          )}
                        />
                      ))}
                    </Routes>
                  </Suspense>
                </main>
              </div>
            </Router>
          </GlobalProvider>
        </AuthGate>
        </ConfirmProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
