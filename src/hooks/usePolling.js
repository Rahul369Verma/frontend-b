import { useEffect, useRef } from 'react';

/**
 * usePolling — setInterval that stops while the tab is hidden.
 *
 * WHY. Eight pages in this app poll the backend on a timer (Dashboard every 8s,
 * Risk every 15s, MultiLeg, TickStrategies, Optimizer, AiManager, DataManager,
 * ParityAudit). None of them checked `document.hidden`, so a dashboard left open
 * in a background tab kept hitting the API forever — for a trading backend that
 * is also placing orders, that is real load bought for nothing, and on a laptop
 * it is real battery.
 *
 * WHAT IT DOES ON RETURN. Coming back to a hidden tab fires the callback
 * IMMEDIATELY and then resumes the timer, rather than waiting out a full
 * interval. That matters here: the first thing you look at after switching back
 * to a trading dashboard is the number, and a stale one is worse than a slow one.
 *
 * WHY THE CALLBACK LIVES IN A REF. The interval is keyed on `intervalMs` and
 * `enabled` only, so a new closure on every render does NOT tear down and
 * restart the timer. Several existing call sites listed their fetch function in
 * the dependency array, which silently restarted the interval whenever that
 * function's identity changed — the timer effectively reset on every render, so
 * the real poll rate was not the one written down.
 *
 * @param {Function} callback   invoked on each tick; always the latest closure
 * @param {number|null} intervalMs  poll period; null/0 disables
 * @param {object}  [options]
 * @param {boolean} [options.enabled=true]    false disables without unmounting
 * @param {boolean} [options.immediate=true]  fire once on mount, before the first delay
 */
export function usePolling(callback, intervalMs, { enabled = true, immediate = true } = {}) {
    const saved = useRef(callback);
    useEffect(() => { saved.current = callback; }, [callback]);

    useEffect(() => {
        if (!enabled || !intervalMs) return undefined;

        let id = null;
        const tick = () => { saved.current?.(); };
        const start = () => { if (id === null) id = setInterval(tick, intervalMs); };
        const stop = () => { if (id !== null) { clearInterval(id); id = null; } };

        const onVisibility = () => {
            if (document.hidden) { stop(); return; }
            tick();     // catch up first…
            start();    // …then resume the cadence
        };

        if (immediate) tick();
        if (!document.hidden) start();
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, intervalMs, immediate]);
}

export default usePolling;

/**
 * pollInterval — a drop-in `setInterval` that pauses while the tab is hidden.
 *
 * WHY THIS EXISTS ALONGSIDE usePolling. The eighteen existing timers each sit
 * inside a useEffect with its own guards, dependency array and cleanup. Porting
 * them all to the hook would mean rewriting eighteen dependency arrays in a
 * dashboard that places real orders — a large diff for a small behavioural fix.
 * This keeps the diff to two tokens per site and changes nothing about when the
 * effect runs or what it closes over.
 *
 * USAGE — the only difference from setInterval is how you cancel it:
 *     const stop = pollInterval(fn, 5000);
 *     return () => stop();            // NOT clearInterval(stop)
 *
 * It returns a cancel FUNCTION, not a numeric id, precisely so that a leftover
 * `clearInterval(...)` is a loud type error rather than a silent no-op leak.
 *
 * Prefer `usePolling` for new code; this is the bridge for what already exists.
 *
 * @returns {() => void} cancel
 */
export function pollInterval(callback, intervalMs, { immediate = false } = {}) {
    if (!intervalMs) return () => {};

    let id = null;
    const tick = () => { callback(); };
    const start = () => { if (id === null) id = setInterval(tick, intervalMs); };
    const stop = () => { if (id !== null) { clearInterval(id); id = null; } };

    const onVisibility = () => {
        if (document.hidden) { stop(); return; }
        tick();     // catch up on return, then resume the cadence
        start();
    };

    if (immediate) tick();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
        stop();
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
