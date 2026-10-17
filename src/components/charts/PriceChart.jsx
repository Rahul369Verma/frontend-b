'use strict';
/**
 * PriceChart — a real candlestick chart, themed, with this desk's trades on it.
 *
 * Wraps TradingView's lightweight-charts (the same engine behind the broker
 * charts you already read) rather than bending recharts into candles: a trading
 * chart needs a crosshair, pan/zoom over tens of thousands of bars, axis price
 * labels and horizontal levels, and recharts gives none of those for free.
 *
 * ── TWO THINGS THIS FILE IS CAREFUL ABOUT ───────────────────────────────────
 * 1. TIME. The API hands back UTC seconds — honest data. lightweight-charts
 *    renders whatever number it is given as if it were UTC, so IST is applied
 *    HERE, once, to candles and markers together (`+5:30`). Doing it in two
 *    places is how a marker ends up 5½ hours from its own candle.
 * 2. IMPERATIVE LIFECYCLE. The chart owns real DOM and must be created once and
 *    disposed once. Everything touching the chart handle happens inside effects
 *    — never during render — because this repo's React-compiler lint (rightly)
 *    treats a ref read in render as a bug.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers,
    CrosshairMode, LineStyle, ColorType,
} from 'lightweight-charts';
import { useChartTheme } from '../viz/tokens';
import { createTrendLinePrimitive, distanceToSegment } from './trendLines';
import { createTradeOverlayPrimitive, barSeconds } from './tradeOverlay';

const IST_SECONDS = 5.5 * 3600;
// ── ONE empty list, not a new [] per render ─────────────────────────────────
// A default of `= []` is a NEW array on every render, so every effect keyed on
// it re-ran on every render: markers re-applied, price lines removed and
// re-created. Each of those makes lightweight-charts re-emit a crosshair event,
// whose hover callback re-rendered the page — a render loop that ran for as long
// as the pointer rested on the chart (17-Oct-2026: 4–5 fps, ~0.9 s of script
// per second while hovering). Module constants keep the identity stable.
const NONE = Object.freeze([]);
const STYLE = { solid: LineStyle.Solid, dotted: LineStyle.Dotted, dashed: LineStyle.Dashed, large: LineStyle.LargeDashed };

/**
 * @param candles     [{ time (utc seconds), open, high, low, close, volume }]
 * @param markers     [{ time, position, shape, color, text }]
 * @param priceLines  [{ price, color, style, title }]
 * @param onHover     called with { time, price, candle } | null as the crosshair moves
 * @param trades      optional — this desk's trades drawn the readable way (tradeOverlay.js):
 *                    small marks, entry→exit lines, numbered bubbles where they crowd,
 *                    a position box for the selected one, words in a hover tooltip.
 *                    [{ id, side, won, entry:{t,p,shape,anchor}, exit }] (UTC seconds)
 * @param selectedTradeId / hoverTradeIds   which trade is focused / highlighted (e.g. a hovered table row)
 * @param onTradeClick(id)      a mark was clicked (a bubble zooms in instead)
 * @param onTradeHover(ids|null) the pointer is over these trades
 * @param onClusterPick(ids) a bubble whose trades share one bar was clicked — zoom cannot
 *        separate them, so the page lists them to pick from
 * @param renderTradeTip(hit)   the tooltip body for { type:'trade', tradeId } | { type:'cluster', tradeIds }
 * @param tradeLabelFor(trade)  { entry, exit } short labels drawn beside the SELECTED trade only
 */
export default function PriceChart({
    candles = NONE, markers = NONE, priceLines = NONE, height = 520,
    showVolume = true, fitKey = null, onHover = null,
    // ── drawing + keyboard ──────────────────────────────────────────────────
    lockToData = false,        // pin the time scale to the loaded bars
    drawMode = false,          // true while the trend-line tool is armed
    lines = NONE,              // committed lines, anchored in {time, price}
    onLinesChange = null,      // (nextLines) => void
    onDrawModeChange = null,   // (bool) => void — so Esc can disarm the tool
    // ── trades (see tradeOverlay.js) ────────────────────────────────────────
    trades = null, selectedTradeId = null, hoverTradeIds = null, showConnectors = true,
    onTradeClick = null, onTradeHover = null, renderTradeTip = null, tradeLabelFor = null, onClusterPick = null,
}) {
    const ct = useChartTheme();
    const boxRef = useRef(null);
    const chartRef = useRef(null);
    const seriesRef = useRef(null);
    const volRef = useRef(null);
    const markerApiRef = useRef(null);
    const linesRef = useRef([]);
    // The crosshair handler is subscribed ONCE (re-subscribing on every parent
    // render would thrash the chart), so the latest callback is kept in a ref —
    // updated in an effect, never during render.
    const hoverRef = useRef(onHover);
    const lastHoverTimeRef = useRef(undefined);
    const lockRef = useRef(lockToData);
    useEffect(() => { hoverRef.current = onHover; }, [onHover]);

    // ── DRAWING STATE ───────────────────────────────────────────────────────
    // The primitive is attached ONCE and reads state through a getter at paint
    // time. Re-attaching on every state change would rebuild the pane view on
    // each pointer move — this way a drag repaints without touching the chart's
    // object graph. Refs (not state) because these are read from a canvas
    // callback that must never trigger a React render of its own.
    const drawRef = useRef({ lines: [], draft: null, selectedId: null, colors: {}, drawMode: false });
    const primitiveRef = useRef(null);
    const linesCbRef = useRef(onLinesChange);
    const drawModeCbRef = useRef(onDrawModeChange);
    const [selectedId, setSelectedId] = useState(null);
    useEffect(() => { linesCbRef.current = onLinesChange; }, [onLinesChange]);
    useEffect(() => { drawModeCbRef.current = onDrawModeChange; }, [onDrawModeChange]);
    useEffect(() => {
        drawRef.current.lines = lines || [];
        drawRef.current.selectedId = selectedId;
        drawRef.current.drawMode = drawMode;
        drawRef.current.colors = { line: ct.mark?.annotation || ct.diverging?.warning || '#f0a202' };
        primitiveRef.current?.repaint?.();
    }, [lines, selectedId, drawMode, ct]);

    // ── TRADES STATE ────────────────────────────────────────────────────────
    // Same pattern as the drawings: one primitive, attached once, reading this
    // ref at paint time; the callbacks live in refs so the once-subscribed
    // crosshair/click handlers always call the latest ones.
    const tradeRef = useRef({ shapes: [], times: [], barsByIndex: [], barSec: 60, selectedId: null, hoverIds: new Set(), connectors: true, colors: {}, labelFor: null });
    const tradePrimRef = useRef(null);
    const tradeClickRef = useRef(onTradeClick);
    const tradeHoverRef = useRef(onTradeHover);
    useEffect(() => { tradeClickRef.current = onTradeClick; }, [onTradeClick]);
    useEffect(() => { tradeHoverRef.current = onTradeHover; }, [onTradeHover]);
    const clusterPickRef = useRef(onClusterPick);
    useEffect(() => { clusterPickRef.current = onClusterPick; }, [onClusterPick]);
    const [tip, setTip] = useState(null);      // { x, y, hit }
    const tipKeyRef = useRef('');

    // Shift to IST once, here. Memoised so a re-render does not re-map 20k bars.
    const bars = useMemo(
        () => candles.map(c => ({ time: c.time + IST_SECONDS, open: c.open, high: c.high, low: c.low, close: c.close })),
        [candles],
    );
    const vols = useMemo(
        () => (showVolume ? candles.map(c => ({ time: c.time + IST_SECONDS, value: c.volume || 0, color: c.close >= c.open ? ct.diverging.positive : ct.diverging.negative })) : []),
        [candles, showVolume, ct],
    );
    // ── MARKERS ARE PINNED TO THE FILL PRICE WHEN WE KNOW IT ────────────────
    // A bar-anchored marker ('aboveBar'/'belowBar') floats above or below
    // whatever candle sits at that time — its height carries NO price meaning.
    // On a losing long trade whose premium fell, that drew the exit visually
    // ABOVE the entry, which reads as a profit and is simply false. v5 supports
    // 'atPriceMiddle' with an explicit `price`, so when the overlay hands us the
    // fill we anchor there and the geometry tells the truth. Markers without a
    // price (structures, open positions) keep the bar anchoring.
    const marks = useMemo(
        () => markers.map(m => {
            const price = Number(m.price);
            const hasPrice = Number.isFinite(price);
            return {
                time: m.time + IST_SECONDS,
                position: hasPrice ? 'atPriceMiddle' : (m.position || 'aboveBar'),
                ...(hasPrice ? { price } : {}),
                shape: m.shape || 'circle',
                color: m.color,
                text: m.text || '',
            };
        }).sort((a, b) => a.time - b.time),
        [markers],
    );

    const tradeShapes = useMemo(() => (trades || []).map(t => ({
        ...t,
        entry: t.entry ? { ...t.entry, t: t.entry.t + IST_SECONDS } : null,
        exit: t.exit ? { ...t.exit, t: t.exit.t + IST_SECONDS } : null,
    })), [trades]);
    useEffect(() => {
        const times = bars.map(b => b.time);
        tradeRef.current = {
            shapes: tradeShapes, times, barsByIndex: bars, barSec: barSeconds(times),
            selectedId: selectedTradeId, hoverIds: new Set(hoverTradeIds || []), connectors: showConnectors !== false,
            labelFor: tradeLabelFor,
            colors: {
                win: ct.diverging.positive, loss: ct.diverging.negative, neutral: ct.text.muted || ct.text.secondary,
                long: ct.categorical[0], short: ct.categorical[1], structure: ct.categorical[2],
                cluster: ct.text.secondary, clusterText: ct.surface, surface: ct.surface,
                labelBg: ct.tooltip.background, labelText: ct.tooltip.text, labelBorder: ct.tooltip.border,
                alpha: ct.alpha,
                // canvas text never sees rem or the Typeface axis — size and face from the theme (see the create effect)
                fontSmall: `${ct.type?.['3xs'] ?? 11}px ${(typeof window !== 'undefined' && getComputedStyle(document.documentElement).fontFamily) || 'sans-serif'}`,
            },
        };
        tradePrimRef.current?.repaint?.();
    }, [tradeShapes, bars, selectedTradeId, hoverTradeIds, showConnectors, tradeLabelFor, ct]);

    // ── create once ─────────────────────────────────────────────────────────
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return undefined;
        const chart = createChart(el, {
            height,
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: ct.text.secondary,
                attributionLogo: false,
                // ── THE TEXT-SIZE AXIS HAS TO BE APPLIED BY HAND HERE ────────
                // lightweight-charts draws its axes, crosshair labels and price
                // line labels into a CANVAS. Canvas text is sized in absolute
                // pixels and never sees `rem`, so the app's Text-size preference
                // — which scales every other glyph on the page — left the price
                // and time axes stuck at the library's fixed 12px. Someone who
                // set 1.4x got bigger tables beside a chart whose numbers did
                // not move at all.
                //
                // `ct.type` is already the scaled px scale used by every recharts
                // axis in this app, so sizing from it keeps a chart label the same
                // size as the table cell next to it. `xs` is 12 at scale 1, which
                // is exactly the library default — nobody who has not touched the
                // setting sees any change.
                fontSize: ct.type?.xs ?? 12,
                // The Typeface axis (System / Serif / Monospace / Legible) is a
                // CSS custom property, which the canvas cannot see either. Read
                // the resolved family off the document root so the chart's
                // numbers use the same face as the table beside them — this is
                // inside the create effect, never during render, so it is a legal
                // DOM read. Falls back to the library default if it is empty.
                fontFamily: (typeof window !== 'undefined'
                    ? getComputedStyle(document.documentElement).fontFamily
                    : '') || undefined,
            },
            grid: { vertLines: { color: ct.gridSoft }, horzLines: { color: ct.gridSoft } },
            crosshair: { mode: CrosshairMode.Normal, vertLine: { color: ct.axis, labelBackgroundColor: ct.tooltip.background }, horzLine: { color: ct.axis, labelBackgroundColor: ct.tooltip.background } },
            // No minimumWidth: lightweight-charts already auto-widths this scale to
            // its widest label, so a floor would only pad narrow premium charts
            // (a two-digit option price) with dead space to solve a problem the
            // library does not have.
            rightPriceScale: { borderColor: ct.grid },
            timeScale: {
                borderColor: ct.grid, timeVisible: true, secondsVisible: false, rightOffset: 4,
                // ── EDGE PINNING IS A CHOICE, NOT A DEFAULT ──────────────────
                // Pinning both edges stops the chart drifting into blank space,
                // which otherwise reads as "the history is missing". But it also
                // removes the ability to zoom OUT past the data — and with a
                // handful of bars (5 daily candles on a 5-day range) those bars
                // are then stretched across the whole pane with no way to shrink
                // them. Whitespace around the data is a legitimate thing to want.
                //
                // So: free by default, lockable on request. The "missing history"
                // confusion is better answered by the Bars tile naming the
                // requested range than by taking a control away.
                // The INITIAL value; later toggles go through applyOptions (the lock
                // effect below) — rebuilding the chart for it left an empty chart.
                fixLeftEdge: lockRef.current,
                fixRightEdge: lockRef.current,
            },
            localization: {
                // The data is IST-shifted, so format as UTC or the browser's own
                // zone would shift it a second time.
                timeFormatter: (t) => new Date(t * 1000).toISOString().slice(11, 16),
                dateFormat: 'dd MMM \'yy',
            },
        });
        const series = chart.addSeries(CandlestickSeries, {
            upColor: ct.diverging.positive, downColor: ct.diverging.negative,
            borderUpColor: ct.diverging.positive, borderDownColor: ct.diverging.negative,
            wickUpColor: ct.diverging.positive, wickDownColor: ct.diverging.negative,
        });
        chartRef.current = chart;
        seriesRef.current = series;

        // Attached once; it reads live state through the ref getter each frame.
        const primitive = createTrendLinePrimitive(() => drawRef.current);
        series.attachPrimitive(primitive);
        primitiveRef.current = primitive;
        const tradePrim = createTradeOverlayPrimitive(() => tradeRef.current);
        series.attachPrimitive(tradePrim);
        tradePrimRef.current = tradePrim;

        if (showVolume) {
            const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
            chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
            volRef.current = vol;
        }

        // While a button is held the user is PANNING: the chart scrolls under a still
        // pointer, so every frame crossed new bars and marks and re-rendered the
        // readout and the tooltip for nothing. Hover work waits for the release.
        let panning = false;
        const onDown = () => { panning = true; };
        const onUp = () => { panning = false; };
        el.addEventListener('pointerdown', onDown);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);

        const onMove = (param) => {
            if (panning) {
                if (tipKeyRef.current) { tipKeyRef.current = ''; setTip(null); tradeHoverRef.current?.(null); }
                return;
            }
            // trades under the pointer → tooltip + highlight (only when it CHANGES)
            const hit = param?.point && tradeRef.current.shapes.length ? tradePrim.hitTest(param.point.x, param.point.y) : null;
            const key = hit ? (hit.type === 'trade' ? `t:${hit.tradeId}` : `c:${hit.tradeIds.join(',')}`) : '';
            if (key !== tipKeyRef.current) {
                tipKeyRef.current = key;
                setTip(hit ? { x: param.point.x, y: param.point.y, w: el.clientWidth, hit } : null);
                tradeHoverRef.current?.(hit ? (hit.type === 'trade' ? [hit.tradeId] : hit.tradeIds) : null);
                el.style.cursor = hit ? 'pointer' : '';
            }
            const cb = hoverRef.current;
            if (!cb) return;
            // Only when the BAR under the pointer changes (or the pointer leaves) — not
            // on every pixel, and never again for a crosshair event the chart re-emits
            // after its own redraw.
            const t = param?.time && param.point ? Number(param.time) : null;
            if (t === lastHoverTimeRef.current) return;
            lastHoverTimeRef.current = t;
            if (t == null) { cb(null); return; }
            const bar = param.seriesData?.get(series);
            cb({ time: t - IST_SECONDS, candle: bar || null });
        };
        chart.subscribeCrosshairMove(onMove);

        // The container is flex-sized, so follow it rather than the window.
        const ro = new ResizeObserver(() => {
            if (el.clientWidth > 0) chart.applyOptions({ width: el.clientWidth });
        });
        ro.observe(el);
        chart.applyOptions({ width: el.clientWidth });

        return () => {
            ro.disconnect();
            el.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            chart.unsubscribeCrosshairMove(onMove);
            try { series.detachPrimitive(primitive); series.detachPrimitive(tradePrim); } catch { /* chart already torn down */ }
            chart.remove();
            chartRef.current = null; seriesRef.current = null; volRef.current = null;
            markerApiRef.current = null; linesRef.current = []; primitiveRef.current = null; tradePrimRef.current = null;
        };
        // Re-creating on a theme switch is deliberate and cheap: lightweight-charts
        // has no way to restyle a series' up/down colours wholesale.
    }, [height, showVolume, ct]);

    // ── lock / free zoom: an option of the existing chart, not a new chart ──
    useEffect(() => {
        lockRef.current = lockToData;
        chartRef.current?.applyOptions({ timeScale: { fixLeftEdge: lockToData, fixRightEdge: lockToData } });
    }, [lockToData]);

    // ── EVERYTHING BELOW RE-APPLIES WHEN THE CHART IS REBUILT ────────────────
    // The chart is rebuilt when its height, volume pane or theme changes. The
    // effects that feed it (candles, markers, levels, the drawing handlers, the
    // zoom) listed only their own inputs, so a rebuilt chart came back EMPTY —
    // "Free zoom" rebuilt it (17-Oct-2026: blank chart after the toggle). They now
    // also depend on what rebuilds it, so they run again, in order, right after.

    // ── data ────────────────────────────────────────────────────────────────
    useEffect(() => {
        const s = seriesRef.current;
        if (!s) return;
        s.setData(bars);
        if (volRef.current) volRef.current.setData(vols);
    }, [bars, vols, height, showVolume, ct]);

    // ── markers (v5: a primitive attached to the series, not series.setMarkers) ──
    useEffect(() => {
        const s = seriesRef.current;
        if (!s) return;
        if (!markerApiRef.current) {
            if (!marks.length) return;                 // nothing to draw: no marker layer at all
            markerApiRef.current = createSeriesMarkers(s, marks);
        } else markerApiRef.current.setMarkers(marks);
    }, [marks, height, showVolume, ct]);

    // ── horizontal levels: stops, targets, strikes, break-evens ─────────────
    useEffect(() => {
        const s = seriesRef.current;
        if (!s) return;
        if (!priceLines.length && !linesRef.current.length) return;   // nothing drawn, nothing to draw
        for (const l of linesRef.current) { try { s.removePriceLine(l); } catch { /* series already gone */ } }
        linesRef.current = priceLines.map(l => s.createPriceLine({
            price: l.price,
            color: l.color,
            lineWidth: 1,
            lineStyle: STYLE[l.style] ?? LineStyle.Dashed,
            axisLabelVisible: true,
            title: l.title || '',
        }));
    }, [priceLines, height, showVolume, ct]);

    // ── DRAWING: two clicks make a line ─────────────────────────────────────
    // Click one anchors the start, the pointer previews a dashed draft, click
    // two commits. Points are stored as {time, price} — see trendLines.js for
    // why pixels would be wrong.
    //
    // While the tool is armed the chart's own pan/zoom handlers are disabled,
    // because a click-drag on a chart means "scroll" and would fight the draw.
    useEffect(() => {
        const chart = chartRef.current, series = seriesRef.current, el = boxRef.current;
        if (!chart || !series || !el) return undefined;
        // Capture the ref OBJECT (stable for the component's life), not its
        // current value — the cleanup below must clear whatever draft exists at
        // teardown, and the lint rule rightly objects to reading `.current` in a
        // cleanup closure.
        const draw = drawRef;

        chart.applyOptions({
            handleScroll: !drawMode,
            handleScale: !drawMode,
        });
        el.style.cursor = drawMode ? 'crosshair' : 'default';

        const toPoint = (param) => {
            if (!param?.point || param.time == null) return null;
            const price = series.coordinateToPrice(param.point.y);
            if (price == null) return null;
            // param.time is already IST-shifted (the series data is), so it is
            // stored as-is and re-projected through the same scale later.
            return { time: param.time, price: Number(price) };
        };

        const onClick = (param) => {
            if (!param?.point) return;
            if (drawMode) {
                const pt = toPoint(param);
                if (!pt) return;
                const d = drawRef.current.draft;
                if (!d) {
                    drawRef.current.draft = { a: pt, b: pt };
                } else {
                    const line = { id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, a: d.a, b: pt };
                    drawRef.current.draft = null;
                    // Degenerate click-click in one spot is not a line; drop it
                    // rather than storing something that can never be seen.
                    if (line.a.time !== line.b.time || line.a.price !== line.b.price) {
                        linesCbRef.current?.([...(drawRef.current.lines || []), line]);
                    }
                }
                primitiveRef.current?.repaint?.();
                return;
            }
            // Not drawing → a trade mark selects that trade; a numbered bubble zooms
            // in until its trades separate.
            const tp = tradePrimRef.current;
            const th = tp && tradeRef.current.shapes.length ? tp.hitTest(param.point.x, param.point.y) : null;
            if (th && th.type === 'trade') { tradeClickRef.current?.(th.tradeId); return; }
            if (th && th.type === 'cluster') {
                const bs = tradeRef.current.barSec || 300;
                const pad = Math.max(bs * 8, (th.tTo - th.tFrom) * 0.6);
                chart.timeScale().setVisibleRange({ from: th.tFrom - pad, to: th.tTo + pad });
                // one bar, one price: no zoom separates them — hand the list to the page to pick from
                if (th.sameBar) clusterPickRef.current?.(th.tradeIds);
                return;
            }
            // …else clicking near a line selects it (and near nothing clears).
            const p = primitiveRef.current;
            if (!p) return;
            let hit = null;
            for (const l of drawRef.current.lines || []) {
                const a = p.project(l.a), b = p.project(l.b);
                if (!a || !b) continue;
                if (distanceToSegment(param.point.x, param.point.y, a.x, a.y, b.x, b.y) <= 6) { hit = l.id; break; }
            }
            setSelectedId(hit);
        };

        const onMove = (param) => {
            if (!drawMode || !drawRef.current.draft || !param?.point) return;
            const pt = toPoint(param);
            if (!pt) return;
            drawRef.current.draft = { ...drawRef.current.draft, b: pt };
            primitiveRef.current?.repaint?.();
        };

        chart.subscribeClick(onClick);
        chart.subscribeCrosshairMove(onMove);
        return () => {
            try { chart.unsubscribeClick(onClick); chart.unsubscribeCrosshairMove(onMove); } catch { /* torn down */ }
            // Leaving a half-drawn draft behind would paint a phantom line the
            // next time the tool is armed.
            draw.current.draft = null;
        };
    }, [drawMode, height, showVolume, ct]);

    // ── KEYBOARD ────────────────────────────────────────────────────────────
    // Scoped to the chart container (tabIndex=0), never to window: a global key
    // handler would hijack +/- while someone is typing in the symbol box or a
    // date field elsewhere on the page.
    const zoomBy = useCallback((factor) => {
        const chart = chartRef.current;
        if (!chart) return;
        const ts = chart.timeScale();
        const r = ts.getVisibleLogicalRange();
        if (!r) return;
        const mid = (r.from + r.to) / 2;
        const half = ((r.to - r.from) / 2) * factor;
        // 2 bars is the floor: below that the chart is a single candle and the
        // user has no way to tell where they are.
        if (half < 1) return;
        ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
    }, []);

    const panBy = useCallback((bars) => {
        const chart = chartRef.current;
        if (!chart) return;
        const ts = chart.timeScale();
        const r = ts.getVisibleLogicalRange();
        if (!r) return;
        ts.setVisibleLogicalRange({ from: r.from + bars, to: r.to + bars });
    }, []);

    const onKeyDown = useCallback((e) => {
        // Never swallow a browser/OS shortcut.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const step = e.shiftKey ? 20 : 5;
        switch (e.key) {
            case '+': case '=': zoomBy(0.8); break;          // narrower range = zoom in
            case '-': case '_': zoomBy(1.25); break;
            case 'ArrowRight': panBy(step); break;
            case 'ArrowLeft': panBy(-step); break;
            case '0': case 'f': case 'F': chartRef.current?.timeScale().fitContent(); break;
            case 'd': case 'D': drawModeCbRef.current?.(!drawMode); break;
            case 'Escape':
                // One key, two jobs, in the order a user expects: abandon the
                // half-drawn line first; only disarm the tool if there isn't one.
                if (drawRef.current.draft) { drawRef.current.draft = null; primitiveRef.current?.repaint?.(); }
                else if (drawMode) drawModeCbRef.current?.(false);
                else setSelectedId(null);
                break;
            case 'Delete': case 'Backspace': {
                const id = drawRef.current.selectedId;
                if (!id) return;
                linesCbRef.current?.((drawRef.current.lines || []).filter(l => l.id !== id));
                setSelectedId(null);
                break;
            }
            default: return;
        }
        e.preventDefault();
    }, [zoomBy, panBy, drawMode]);

    // ── zoom to a trade, or back out to everything ──────────────────────────
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || !bars.length) return;
        if (!fitKey || !fitKey.from || !fitKey.to) { chart.timeScale().fitContent(); return; }
        // ── CONTEXT, NOT A KEYHOLE ──────────────────────────────────────────
        // This used to pad by max(300s, 25% of the trade), so a five-minute trade
        // zoomed to a FIFTEEN MINUTE window: three candles, no run-up, no
        // aftermath, and no way to judge whether the entry was sensible or the
        // stop was ever close. A trade is only readable next to what preceded it.
        //
        // Pad proportionally to the hold, floored at half an hour so a scalp
        // still shows its setup, and capped at three hours so an overnight hold
        // does not zoom back out to nothing.
        const HALF_HOUR = 1800, THREE_HOURS = 10800;
        const span = Math.max(0, fitKey.to - fitKey.from);
        const pad = Math.min(THREE_HOURS, Math.max(HALF_HOUR, span * 1.5));
        chart.timeScale().setVisibleRange({ from: fitKey.from + IST_SECONDS - pad, to: fitKey.to + IST_SECONDS + pad });
    }, [fitKey, bars, height, showVolume, ct]);

    const tipBody = tip && renderTradeTip ? renderTradeTip(tip.hit) : null;
    return (
        <div style={{ position: 'relative', width: '100%' }}>
        <div
            ref={boxRef}
            style={{ width: '100%', height, outline: 'none' }}
            // tabIndex so the container can hold focus and receive keys without a
            // window-level listener stealing them from other inputs on the page.
            tabIndex={0}
            role="application"
            aria-label="Price chart. Plus and minus zoom, arrow keys pan, F fits, D toggles the trend-line tool, Delete removes the selected line."
            onKeyDown={onKeyDown}
        />
        {tipBody && (
            // follows the mark, flips left near the right edge so it never leaves the chart
            <div role="tooltip" data-testid="trade-tip"
                className="absolute z-20 pointer-events-none max-w-xs rounded border px-2 py-1.5 text-2xs shadow-lg"
                style={{
                    left: tip.x > tip.w - 260 ? undefined : tip.x + 14,
                    right: tip.x > tip.w - 260 ? tip.w - tip.x + 14 : undefined,
                    top: Math.max(4, Math.min(tip.y + 14, height - 120)),
                    background: ct.tooltip.background, borderColor: ct.tooltip.border, color: ct.tooltip.text,
                }}>
                {tipBody}
            </div>
        )}
        </div>
    );
}
