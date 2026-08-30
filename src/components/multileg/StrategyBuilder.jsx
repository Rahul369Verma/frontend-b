import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { Help, Tile } from './builderUi';
import ChainLadder from './ChainLadder';
import AnalysisTabs from './AnalysisTabs';
import {
    num, fmt, rup, pct, sgn, shortSym, addDays, interpAt, sdFor, SD_HORIZON_NOTE,
    inputCls, cellCls, btnCls,
} from './builderFormat';
import { API_URL } from '../../config/api.js';

/**
 * STRATEGY BUILDER — draw ANY option structure leg-by-leg and see everything
 * about it before committing: payoff at expiry and today, greeks (book AND per
 * leg), a spot × date P&L grid, probability of profit, margin, real bid/ask
 * cost, and what happens if spot / IV / time move.
 *
 * Deliberately NOT template-bound. The rest of the Multi-Leg page resolves a
 * structure through TEMPLATES[...] (relative offsets from ATM); this panel
 * talks to /multileg/builder/*, which describes an arbitrary leg list. A
 * template can SEED the builder (offsets resolved to absolute strikes) but from
 * that moment the legs are yours to edit.
 *
 * Everything on screen is GROSS unless a tile says otherwise — charges are
 * reported separately so the cost is never silently netted into a headline.
 *
 * LAYOUT
 *   this file      instrument, seeding, the leg editor and its structure
 *                  adjusters, the stats / book-greeks / what-if cards, saving
 *   ChainLadder    the strike picker in three views (LTP / OI / Greeks)
 *   AnalysisTabs   Payoff (still drawn through ZoomableChart, so drag-zoom
 *                  keeps working) / P&L Table / per-leg Greeks / resolved Legs
 *   builderFormat  the formatters every number on all of the above goes through
 */


const SYMBOLS = [
    { v: 'NSE:NIFTY50-INDEX', label: 'NIFTY' },
    { v: 'NSE:NIFTYBANK-INDEX', label: 'BANKNIFTY' },
    { v: 'NSE:FINNIFTY-INDEX', label: 'FINNIFTY' },
    { v: 'NSE:MIDCPNIFTY-INDEX', label: 'MIDCPNIFTY' },
    { v: 'BSE:SENSEX-INDEX', label: 'SENSEX' },
    { v: 'BSE:BANKEX-INDEX', label: 'BANKEX' },
];

const MAX_LEGS = 12;   // the server rejects a 13th — refuse locally rather than round-trip a 400
const RATIO_MULTIPLIERS = [1, 2, 3, 5, 10];

const GRADE_STYLE = {
    good: 'text-emerald-300 border-emerald-700/50 bg-emerald-950/20',
    fair: 'text-sky-300 border-sky-700/50 bg-sky-950/20',
    poor: 'text-amber-300 border-amber-700/50 bg-amber-950/10',
    untradeable: 'text-red-300 border-red-700/50 bg-red-950/25',
    unknown: 'text-fg-4 border-line-2 bg-slate-800/40',
};
const GRADE_NOTE = {
    good: 'tight book — spread costs are negligible on these legs',
    fair: 'workable, but the wings cost real money',
    poor: 'wide book — the spread eats a meaningful slice of this structure',
    untradeable: 'the market maker takes more than this structure makes',
    unknown: 'not measured — costs fall back to the flat 0.50% assumption',
};

let LEG_SEQ = 0;
const newLeg = (over = {}) => ({
    id: `L${++LEG_SEQ}`, type: 'CE', action: 'SELL', strike: '', ratio: 1, expiry: '', premium: '', ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * ExpiryPick — the LISTED expiries, not a free date field.
 *
 * A date input happily accepts a Monday for a Tuesday-expiry index, which builds
 * option symbols that cannot exist and fails much later as an opaque
 * "no quote for NSE:NIFTY2683124300CE". The broker publishes its own expiry
 * list; offering that makes the mistake unreachable. Falls back to a date input
 * when the list is unavailable, so a broker outage never blocks manual entry.
 */
function ExpiryPick({ value, onChange, chain, className, title }) {
    const listed = Array.isArray(chain?.expiries) ? chain.expiries : [];
    const current = value || chain?.expiry || '';
    if (!listed.length) {
        return <input type="date" value={current} onChange={e => onChange(e.target.value)}
            className={className} title={`${title || 'Expiry'} — broker expiry list unavailable, so any date is accepted (it may not be a real expiry)`} />;
    }
    // an out-of-list value can arrive from a saved structure; keep it selectable
    // and visibly flagged rather than silently snapping to another date
    const off = current && !listed.some(e => e.iso === current);
    return (
        <select value={current} onChange={e => onChange(e.target.value)}
            className={className} title={title || 'Expiry — only dates the broker actually lists'}>
            {off && <option value={current}>{current} — NOT LISTED</option>}
            {listed.map(e => (
                <option key={e.iso} value={e.iso}>
                    {e.iso}{e.flag ? ` (${e.flag})` : ''}
                </option>
            ))}
        </select>
    );
}

export default function StrategyBuilder() {
    // instrument / expiry / size
    const [symbol, setSymbol] = useState(SYMBOLS[0].v);
    const [expiry, setExpiry] = useState('');            // '' = let the server pick the next expiry
    const [lots, setLots] = useState(1);
    const [count, setCount] = useState(12);              // strikes each side of ATM in the ladder

    // chain (strike picker)
    const [chain, setChain] = useState(null);
    const [chainErr, setChainErr] = useState(null);
    const [chainLoading, setChainLoading] = useState(false);
    const [chainView, setChainView] = useState('ltp');   // ltp | oi | greeks

    // the structure itself
    const [legs, setLegs] = useState([]);
    const [activeLegId, setActiveLegId] = useState(null); // when set, a ladder click RETARGETS this leg
    const [pickAction, setPickAction] = useState('SELL'); // otherwise a click ADDS a leg with this action
    // The ratio multiplier is a RELATIVE control: it remembers what it last
    // applied, so picking 3× after 2× scales by 3/2 instead of compounding to
    // 6×. That makes it reversible — going back to 1× restores the ratios the
    // structure was seeded/typed with.
    const [ratioMult, setRatioMult] = useState(1);

    // pricing overrides (blank = live)
    const [spotOverride, setSpotOverride] = useState('');
    const [ivOverride, setIvOverride] = useState('');

    // what-if
    const [wifOn, setWifOn] = useState(false);
    const [wifSpotPct, setWifSpotPct] = useState(0);      // ±5% of the anchor spot
    const [wifIvShift, setWifIvShift] = useState(0);      // ±10 IV points
    const [wifDays, setWifDays] = useState(0);            // calendar days forward

    // Which σ horizon the SD table AND the payoff bands use. Defaults to
    // CALENDAR because that is what other platforms quote; the trading-time one
    // is what this system's own pricing and greeks ran on. Both are labelled
    // wherever they are drawn — see sdFor() in builderFormat.
    const [sdMode, setSdMode] = useState('calendar');
    const [chargesOpen, setChargesOpen] = useState(false);

    // analysis
    const [resp, setResp] = useState(null);
    const [err, setErr] = useState(null);                // { status, error, hint?, legs? }
    const [loading, setLoading] = useState(false);

    // templates + save
    const [templates, setTemplates] = useState([]);
    // live/paper deployments, so an existing position can be pulled apart here
    const [deployments, setDeployments] = useState([]);
    const [depKey, setDepKey] = useState('');
    const [depNote, setDepNote] = useState(null);
    const [tplKey, setTplKey] = useState('');
    const [saveName, setSaveName] = useState('');
    const [saveState, setSaveState] = useState(null);    // { ok, msg }
    const [saving, setSaving] = useState(false);

    const abortRef = useRef(null);
    const seqRef = useRef(0);
    const atmRowRef = useRef(null);

    // Anchor for the what-if spot slider. It must NOT come from the analyze
    // response: that response changes every time the live spot ticks, which
    // would move the slider's own base, change the request body, and refire the
    // analyze call in a loop. The chain fetch is user-driven, so its spot is a
    // stable anchor.
    // The fallback (used when the chain endpoint is down) is LATCHED on the
    // first analysis and never updated, for the same reason: reading the live
    // resp.spot every render would make each response move the slider's base,
    // rewrite the request body, and fire the next request — a self-sustaining
    // 350ms poll for as long as the what-if overlay is on.
    const [anchorFallback, setAnchorFallback] = useState(null);
    useEffect(() => { setAnchorFallback(null); }, [symbol]);
    useEffect(() => {
        if (anchorFallback == null && num(resp?.spot) > 0) setAnchorFallback(num(resp.spot));
    }, [resp, anchorFallback]);
    const anchorSpot = num(chain?.spot) ?? anchorFallback ?? null;

    // ── templates (once) ─────────────────────────────────────────────────────
    useEffect(() => {
        let dead = false;
        axios.get(`${API_URL}/multileg/deployments`)
            .then(r => setDeployments(Array.isArray(r.data?.deployments) ? r.data.deployments : []))
            .catch(() => setDeployments([]));
        axios.get(`${API_URL}/multileg/templates`)
            .then(r => { if (!dead) setTemplates(Array.isArray(r.data) ? r.data : []); })
            .catch(() => { if (!dead) setTemplates([]); });
        return () => { dead = true; };
    }, []);

    // ── chain (symbol / expiry / depth) ──────────────────────────────────────
    const loadChain = useCallback(() => {
        let dead = false;
        setChainLoading(true); setChainErr(null);
        const params = { symbol, count };
        if (expiry) params.expiry = expiry;
        axios.get(`${API_URL}/multileg/builder/chain`, { params })
            .then(r => { if (!dead) { setChain(r.data || null); setChainErr(null); } })
            .catch(e => {
                if (dead) return;
                setChain(null);
                setChainErr(e.response?.data?.error || e.message || 'chain unavailable');
            })
            .finally(() => { if (!dead) setChainLoading(false); });
        return () => { dead = true; };
    }, [symbol, expiry, count]);
    useEffect(() => loadChain(), [loadChain]);

    // Park the ladder on ATM rather than at the top — the strikes anyone cares
    // about are the middle ones. Re-run on a view switch too: the three views
    // have different row heights, so the old scroll offset no longer lands on
    // ATM.
    useEffect(() => {
        if (atmRowRef.current?.scrollIntoView) {
            try { atmRowRef.current.scrollIntoView({ block: 'center' }); } catch { /* jsdom / old browsers */ }
        }
    }, [chain, chainView]);

    // Changing instrument invalidates every strike (different spot AND different
    // strike step), so the legs are cleared rather than silently carried over as
    // strikes that do not exist on the new underlying.
    const changeSymbol = (v) => {
        setSymbol(v); setExpiry(''); setLegs([]); setActiveLegId(null); setRatioMult(1);
        setResp(null); setErr(null); setTplKey(''); setSaveState(null);
    };

    // ── request body (memoised, and serialised as the effect key) ────────────
    const validLegs = useMemo(() => legs.filter(l => num(l.strike) > 0 && (l.type === 'CE' || l.type === 'PE') && (l.action === 'BUY' || l.action === 'SELL')), [legs]);

    // The server echoes back only the legs it was SENT, in that order. Indexing
    // its reply by the editor's row number would mis-pair every leg the moment
    // one row is a half-typed blank strike, so the mapping goes through leg id.
    const validIndex = useMemo(() => {
        const m = new Map();
        validLegs.forEach((l, i) => m.set(l.id, i));
        return m;
    }, [validLegs]);

    const body = useMemo(() => {
        const b = {
            symbol,
            lots: Math.max(1, num(lots) || 1),
            legs: validLegs.map(l => {
                const leg = {
                    type: l.type, action: l.action,
                    strike: num(l.strike),
                    ratio: Math.max(1, num(l.ratio) || 1),
                };
                const e = l.expiry || expiry || chain?.expiry;
                if (e) leg.expiry = e;
                const p = num(l.premium);
                if (p > 0) leg.premium = p;         // blank premium = priced live by the server
                return leg;
            }),
        };
        if (num(spotOverride) > 0) b.spotOverride = num(spotOverride);
        if (num(ivOverride) > 0) b.ivOverride = num(ivOverride);          // PERCENT, e.g. 12.5
        if (wifOn && anchorSpot > 0) {
            b.whatIf = {
                spot: Math.round(anchorSpot * (1 + (num(wifSpotPct) || 0) / 100)),
                ivShiftPct: num(wifIvShift) || 0,
                daysForward: Math.max(0, num(wifDays) || 0),
            };
        }
        return b;
    }, [symbol, lots, validLegs, expiry, chain?.expiry, spotOverride, ivOverride, wifOn, anchorSpot, wifSpotPct, wifIvShift, wifDays]);

    const bodyKey = JSON.stringify(body);

    // ── analyze: debounced, abortable, stale-response-proof ──────────────────
    useEffect(() => {
        const payload = JSON.parse(bodyKey);
        if (!payload.legs.length) {
            abortRef.current?.abort();
            seqRef.current += 1;                 // orphan anything already in flight
            setResp(null); setErr(null); setLoading(false);
            return undefined;
        }
        const timer = setTimeout(async () => {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            const seq = ++seqRef.current;
            setLoading(true);
            try {
                const r = await axios.post(`${API_URL}/multileg/builder/analyze`, payload, { signal: ac.signal });
                if (seq !== seqRef.current) return;                       // a newer request already won
                setResp(r.data || null); setErr(null);
            } catch (e) {
                if (axios.isCancel?.(e) || e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
                if (seq !== seqRef.current) return;
                const d = e.response?.data || {};
                setErr({ status: e.response?.status || 0, error: d.error || e.message || 'analyze failed', hint: d.hint, legs: d.legs, badExpiries: d.badExpiries, expiries: d.expiries });
                // Stale stats beside a fresh error read as authoritative. Drop them.
                setResp(null);
            } finally {
                if (seq === seqRef.current) setLoading(false);
            }
        }, 350);                                  // ~350ms: a slider drag or a typed strike sends ONE request
        return () => clearTimeout(timer);
    }, [bodyKey]);

    useEffect(() => () => abortRef.current?.abort(), []);

    // ── leg mutations ────────────────────────────────────────────────────────
    const patchLeg = (id, p) => setLegs(ls => ls.map(l => (l.id === id ? { ...l, ...p } : l)));
    const removeLeg = (id) => { setLegs(ls => ls.filter(l => l.id !== id)); setActiveLegId(a => (a === id ? null : a)); };
    const dupLeg = (id) => setLegs(ls => {
        if (ls.length >= MAX_LEGS) return ls;
        const i = ls.findIndex(l => l.id === id);
        if (i < 0) return ls;
        const copy = { ...ls[i], id: `L${++LEG_SEQ}` };
        return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)];
    });
    const reverseAll = () => setLegs(ls => ls.map(l => ({ ...l, action: l.action === 'BUY' ? 'SELL' : 'BUY' })));
    const addLeg = (over = {}) => setLegs(ls => (ls.length >= MAX_LEGS ? ls : [...ls, newLeg({
        strike: chain?.atm ?? '', expiry: chain?.expiry || expiry || '', ...over,
    })]));
    const syncExpiries = () => {
        const e = chain?.expiry || expiry;
        if (e) setLegs(ls => ls.map(l => ({ ...l, expiry: e })));
    };
    const clearLegs = () => { setLegs([]); setActiveLegId(null); setTplKey(''); setRatioMult(1); };

    // ── STRUCTURE ADJUSTERS ──────────────────────────────────────────────────
    // Every one of these moves strikes by the CHAIN's own step, so a structure
    // can never be nudged onto a strike that does not trade. Any moved leg has
    // its pinned premium cleared: a price pinned at 24,500 is not the price of
    // 24,550, and carrying it across would quietly analyse a fiction.
    const step = num(chain?.step) || 50;
    const distinctStrikes = useMemo(
        () => [...new Set(validLegs.map(l => num(l.strike)).filter(v => v != null && v > 0))].sort((a, b) => a - b),
        [validLegs],
    );
    const canWidth = distinctStrikes.length >= 2;
    const centreStrike = canWidth ? (distinctStrikes[0] + distinctStrikes[distinctStrikes.length - 1]) / 2 : null;
    const widthReason = 'Disabled — a structure needs at least two different strikes before it has a width to change. A straddle or a single leg has none.';

    const bumpStrike = (id, dir) => setLegs(ls => ls.map(l => {
        if (l.id !== id) return l;
        const base = num(l.strike) ?? num(chain?.atm) ?? 0;
        const next = base + dir * step;
        return next > 0 ? { ...l, strike: next, premium: '' } : l;
    }));

    /** Slide the WHOLE structure one step — same shape, different centre. */
    const shiftAll = (dir) => setLegs(ls => {
        const next = ls.map(l => {
            const k = num(l.strike);
            if (k == null || k <= 0) return l;
            return { ...l, strike: k + dir * step, premium: '' };
        });
        // refuse the whole move if it would push any leg to a nonsense strike
        return next.some(l => num(l.strike) != null && num(l.strike) <= 0) ? ls : next;
    });

    /** dir = +1 widen (legs move outward), −1 narrow (legs move inward). */
    const changeWidth = (dir) => setLegs(ls => {
        const ks = [...new Set(ls.map(l => num(l.strike)).filter(v => v != null && v > 0))];
        if (ks.length < 2) return ls;
        const centre = (Math.min(...ks) + Math.max(...ks)) / 2;
        return ls.map(l => {
            const k = num(l.strike);
            if (k == null || k <= 0 || k === centre) return l;   // a leg on the centre is the pivot
            const outward = k > centre ? 1 : -1;
            const next = k + outward * dir * step;
            // Narrowing must never flip a leg past the centre — that turns a
            // condor inside out rather than tightening it. A leg that cannot
            // move without crossing simply stays put, which is also what keeps
            // every strike on the chain's grid when the centre falls between
            // two strikes.
            if (dir < 0 && ((k > centre && next < centre) || (k < centre && next > centre))) return l;
            if (!(next > 0)) return l;
            return { ...l, strike: next, premium: '' };
        });
    });

    /** Scale every leg's ratio. Relative to whatever multiplier is already
     *  applied, so the select behaves like a dial rather than a ratchet. */
    const applyMultiplier = (m) => {
        const mult = num(m) || 1;
        const prev = num(ratioMult) || 1;
        if (mult === prev) return;
        setLegs(ls => ls.map(l => ({
            ...l,
            ratio: Math.max(1, Math.round((Math.max(1, num(l.ratio) || 1) * mult) / prev)),
        })));
        setRatioMult(mult);
    };

    /** Ladder click — retarget the selected leg, else append a new one. */
    const pickStrike = (strike, type) => {
        if (activeLegId && legs.some(l => l.id === activeLegId)) {
            patchLeg(activeLegId, { strike, type, premium: '' });  // a new strike invalidates a pinned premium
            return;
        }
        addLeg({ strike, type, action: pickAction, premium: '' });
    };

    // ── load a DEPLOYED structure ────────────────────────────────────────────
    // Two quite different cases, and conflating them would be misleading:
    //   OPEN      — the position exists. Load its ACTUAL strikes, expiries and
    //               fill prices, so what you see is the real book, not a
    //               re-derivation of it.
    //   IDLE/other— nothing is open, so there is nothing to copy. Fall back to
    //               resolving the deployment's template at TODAY's ATM, which
    //               is what it would open if it fired now.
    const loadDeployment = (key) => {
        setDepKey(key);
        setSaveState(null);
        setDepNote(null);
        setRatioMult(1);                 // the loaded ratios become the new baseline
        if (!key) return;
        const d = deployments.find(x => String(x._id) === key);
        if (!d) return;

        // switching underlying invalidates strikes AND the step, so follow it
        if (d.symbol && d.symbol !== symbol) { setSymbol(d.symbol); setExpiry(''); }

        const pos = d.position || {};
        const live = [...(pos.legs || []), ...(pos.closedLegs || [])]
            .filter(l => l && l.strike && l.type && l.action);

        if (live.length) {
            setLegs(live.slice(0, MAX_LEGS).map(l => newLeg({
                type: l.type, action: l.action,
                strike: num(l.strike), ratio: Math.max(1, num(l.ratio) || 1),
                expiry: l.expiry || '',
                // entry fills, not live marks — this is the position AS OPENED.
                // Clear a leg's premium to re-price it at the current market.
                premium: num(l.entryPrice) > 0 ? String(l.entryPrice) : '',
            })));
            setActiveLegId(null);
            const closed = (pos.closedLegs || []).length;
            setDepNote(`Loaded the OPEN position at its entry fills${closed ? ` — includes ${closed} leg(s) already closed` : ''}. Clear a premium to re-price it live.`);
            return;
        }

        // nothing open — resolve the recipe at today's ATM
        if (d.template && d.template !== 'custom') {
            seedTemplate(d.template);
            setDepNote(`${d.name} is ${pos.state || 'IDLE'} — no live position to copy, so its template was resolved at today's ATM.`);
        } else if (Array.isArray(d.legs) && d.legs.length) {
            setLegs(d.legs.slice(0, MAX_LEGS).map(l => newLeg({
                type: l.type, action: l.action, strike: num(l.strike),
                ratio: Math.max(1, num(l.ratio) || 1), expiry: l.expiry || '', premium: '',
            })));
            setActiveLegId(null);
            setDepNote(`${d.name} is ${pos.state || 'IDLE'} — loaded its saved custom legs.`);
        } else {
            setDepNote(`${d.name} has no open position and no legs to load.`);
        }
    };

    // ── template seeding ─────────────────────────────────────────────────────
    const seedTemplate = (key) => {
        setTplKey(key);
        setSaveState(null);
        setRatioMult(1);            // template ratios are the new baseline
        const t = templates.find(x => x.key === key);
        if (!t || !Array.isArray(t.legs) || !chain) return;
        const atm = num(chain.atm), stepv = num(chain.step);
        if (!(atm > 0) || !(stepv > 0)) return;
        const near = chain.expiry || expiry || '';
        // Backend convention (logic/multileg/templates.js legStrike): offset is
        // in strike STEPS *toward OTM* — CE offsets go UP, PE offsets go DOWN.
        // Reading '+2' as 'two steps above' for both sides would mirror every
        // put leg onto the wrong side of the money.
        const seeded = t.legs.slice(0, MAX_LEGS).map(l => newLeg({
            type: l.type, action: l.action,
            strike: atm + (l.type === 'CE' ? 1 : -1) * (num(l.offset) || 0) * stepv,
            ratio: Math.max(1, num(l.ratio) || 1),
            // FAR legs (calendars) need a later expiry than the chain gives us.
            // There is no expiry-list endpoint, so a +7d placeholder is seeded
            // and flagged — an editable guess beats a silently wrong date.
            expiry: l.expiry === 'FAR' && near ? addDays(near, 7) : near,
            premium: '',
        }));
        setLegs(seeded);
        setActiveLegId(null);
    };
    const seededFar = useMemo(() => {
        const t = templates.find(x => x.key === tplKey);
        return !!t?.legs?.some(l => l.expiry === 'FAR');
    }, [templates, tplKey]);

    // ── derived analysis ─────────────────────────────────────────────────────
    const an = resp?.analysis || null;
    const wif = resp?.whatIf || null;
    const liq = resp?.liquidity || null;
    const spot = num(resp?.spot) ?? num(chain?.spot);
    const lotSize = num(resp?.lotSize) ?? num(chain?.lotSize);
    const strikeMarks = useMemo(() => [...new Set(validLegs.map(l => num(l.strike)).filter(v => v > 0))].sort((a, b) => a - b), [validLegs]);

    // Whichever σ horizon the user has toggled — shared by the SD table below
    // and the payoff bands above, so the two can never disagree on screen.
    const sd = useMemo(() => sdFor(an, sdMode, spot), [an, sdMode, spot]);

    // Chart series: the base curve's x values are the grid; the what-if curve is
    // resampled onto them (see interpAt).
    const chartData = useMemo(() => {
        const base = Array.isArray(an?.curve) ? an.curve : [];
        if (!base.length) return [];
        const wc = Array.isArray(wif?.curve) ? wif.curve : null;
        const wKey = wc && wc.some(p => num(p.now) != null) ? 'now' : 'expiry';
        return base.map(p => ({
            spot: p.spot,
            expiry: num(p.expiry),
            now: num(p.now),
            whatif: wc ? interpAt(wc, p.spot, wKey) : null,
        }));
    }, [an, wif]);
    const hasNow = useMemo(() => chartData.some(p => p.now != null), [chartData]);
    const hasWif = useMemo(() => chartData.some(p => p.whatif != null), [chartData]);

    /**
     * Y-DOMAIN — deliberately explicit, never 'auto'.
     *
     * A structure with a naked short has a payoff tail that runs to −∞ over the
     * plotted spot window. Auto-scaling frames that tail, which squashes the
     * credit, the breakevens and the entire profit zone into a one-pixel smear
     * on the zero line — the chart technically shows everything and usefully
     * shows nothing. So the window is framed on the DECISION region instead:
     * the payoff within ~1.6σ of spot (widened to cover every breakeven), plus
     * zero and any FINITE max profit/loss. The tail is then clipped by
     * allowDataOverflow, and reference levels carry ifOverflow="extendDomain"
     * so a TP/BE/spot marker can never silently vanish off the clipped edge.
     */
    const yDomain = useMemo(() => {
        if (!chartData.length || !(spot > 0)) return ['auto', 'auto'];
        const em = num(an?.expectedMove);
        const bes = (an?.breakevens || []).map(num).filter(v => v != null && v > 0);
        const beReach = bes.length ? Math.max(...bes.map(b => Math.abs(b - spot))) * 1.25 : 0;
        const band = Math.max(em > 0 ? em * 1.6 : 0, beReach, spot * 0.03);
        const vals = [0];
        for (const p of chartData) {
            if (Math.abs(p.spot - spot) > band) continue;
            for (const k of ['expiry', 'now', 'whatif']) if (p[k] != null) vals.push(p[k]);
        }
        // finite extremes belong in frame; unbounded ones are exactly what we clip
        if (!an?.unboundedProfit && num(an?.maxProfitRupees) != null) vals.push(num(an.maxProfitRupees));
        if (!an?.unbounded && num(an?.maxLossRupees) != null) vals.push(num(an.maxLossRupees));
        if (vals.length < 2) return ['auto', 'auto'];
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const pad = Math.max((hi - lo) * 0.18, 500);
        return [Math.round(lo - pad), Math.round(hi + pad)];
    }, [chartData, spot, an]);

    const xTicks = useMemo(() => {
        if (!chartData.length) return undefined;
        const lo = chartData[0].spot, hi = chartData[chartData.length - 1].spot;
        const t = [...strikeMarks];
        if (spot > 0) t.push(Math.round(spot));
        return [...new Set(t)].filter(v => v >= lo && v <= hi).sort((a, b) => a - b);
    }, [chartData, strikeMarks, spot]);

    // ── charges versus the best case ─────────────────────────────────────────
    // Only a FINITE max profit gives a percentage any meaning: an unbounded
    // best case would divide by null and read as a comfortingly small number.
    const chargesRupees = num(resp?.charges?.roundTripRupees);
    const bestCase = an?.unboundedProfit ? null : num(an?.maxProfitRupees);
    const chargePctOfBest = (chargesRupees != null && bestCase != null && bestCase > 0)
        ? (chargesRupees / bestCase) * 100 : null;
    const chargesHeavy = chargePctOfBest != null && chargePctOfBest > 25;

    // ── save ─────────────────────────────────────────────────────────────────
    const save = async () => {
        const name = saveName.trim();
        if (!name) { setSaveState({ ok: false, msg: 'name the structure first' }); return; }
        if (!validLegs.length) { setSaveState({ ok: false, msg: 'nothing to save — add a leg' }); return; }
        setSaving(true); setSaveState(null);
        try {
            await axios.post(`${API_URL}/multileg/strategies`, {
                name, template: 'custom', symbol,
                legs: body.legs,
                params: { lots: body.lots, ...(num(ivOverride) > 0 ? { iv_override_pct: num(ivOverride) } : {}) },
                notes: `Built in the strategy builder${an ? ` · ${an.isCredit ? 'credit' : 'debit'} ${fmt(Math.abs(num(an.netPremiumUnit)), 2)}/u · ${validLegs.length} legs` : ''}`,
            });
            setSaveState({ ok: true, msg: `saved as “${name}”` });
        } catch (e) {
            setSaveState({ ok: false, msg: e.response?.data?.error || e.message || 'save failed' });
        } finally { setSaving(false); }
    };

    // ── error banner (all three server shapes are distinct problems) ─────────
    const errorBanner = err && (
        <div className={`rounded-lg border p-2.5 mb-3 ${err.status === 422 ? 'border-amber-700/60 bg-amber-950/20' : 'border-red-800/60 bg-red-950/20'}`}>
            <div className={`text-2xs font-semibold ${err.status === 422 ? 'text-amber-200' : 'text-red-200'}`}>
                {err.status === 400 && '✕ Invalid structure'}
                {err.status === 422 && (err.badExpiries?.length
                    ? '⚠ That is not a real expiry date'
                    : '⚠ A strike could not be priced')}
                {err.status === 503 && '✕ No spot quote'}
                {![400, 422, 503].includes(err.status) && '✕ Analyze failed'}
            </div>
            <div className="text-2xs text-fg-3 mt-0.5 break-words">{err.error}</div>
            {err.hint && <div className="text-3xs text-amber-300/90 mt-1">{err.hint}</div>}
            {err.status === 422 && Array.isArray(err.legs) && (
                <div className="text-3xs text-fg-4 font-mono mt-1 space-y-0.5">
                    {err.legs.map((l, i) => (
                        <div key={i} className={num(l.premium) > 0 ? 'text-fg-5' : 'text-amber-300'}>
                            {num(l.premium) > 0 ? '✓' : '✕'} {l.action} {l.ratio > 1 ? `${l.ratio}× ` : ''}{l.type} {fmt(l.strike)} {l.expiry} — {num(l.premium) > 0 ? `₹${fmt(l.premium, 2)}` : 'no quote'}
                        </div>
                    ))}
                </div>
            )}
            {err.status === 503 && <div className="text-3xs text-fg-5 mt-1">The broker feed has no live price for {shortSym(symbol)}. Set a spot override below to price the structure anyway.</div>}
        </div>
    );

    const chainDead = chain && chain.source === 'none';

    return (
        <div className="space-y-3">
            {/* ── HEADER / INSTRUMENT ───────────────────────────────────── */}
            <div className="bg-surface rounded-xl border border-line p-4">
                <div className="text-sm font-semibold text-fg mb-3 flex items-center gap-2 flex-wrap">
                    🧱 Strategy builder
                    <span className="text-fg-5 font-normal text-2xs">— draw any structure leg-by-leg and see everything before committing</span>
                    {loading && <span className="text-3xs text-sky-400">analysing…</span>}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <label className="text-fg-4">Symbol
                        <select value={symbol} onChange={e => changeSymbol(e.target.value)} className={inputCls}>
                            {SYMBOLS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                        </select>
                    </label>
                    <label className="text-fg-4">Expiry<Help k="expiry" />
                        <ExpiryPick value={expiry} onChange={setExpiry} chain={chain} className={inputCls} />
                    </label>
                    <label className="text-fg-4">Lots
                        <input type="number" min={1} value={lots}
                            onChange={e => setLots(Math.max(1, num(e.target.value) || 1))} className={inputCls} />
                    </label>
                    <label className="text-fg-4" title="Spot used for pricing. Blank = the live broker quote.">Spot override
                        <input type="number" value={spotOverride} placeholder={spot != null ? `live ${fmt(spot)}` : 'live'}
                            onChange={e => setSpotOverride(e.target.value)} className={inputCls} />
                    </label>
                    <label className="text-fg-4" title="Implied volatility in PERCENT (e.g. 12.5). Blank = backed out of the nearest-to-money leg.">IV override %
                        <input type="number" step="0.1" value={ivOverride}
                            placeholder={num(an?.ivUsed) != null ? `used ${fmt(an.ivUsed, 2)}` : 'auto'}
                            onChange={e => setIvOverride(e.target.value)} className={inputCls} />
                    </label>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-3xs text-fg-5 mt-2">
                    <span>spot <span className="text-sky-300 font-semibold">{fmt(spot)}</span></span>
                    <span>ATM {fmt(chain?.atm)}</span>
                    <span>step {fmt(chain?.step)}</span>
                    <span>lot {fmt(lotSize)}</span>
                    <span>×{fmt(body.lots)} lots = {fmt((num(lotSize) || 0) * body.lots)} units</span>
                    {num(chain?.atmIv) != null && <span>ATM IV {fmt(chain.atmIv, 2)}%</span>}
                    {num(chain?.pcr) != null && <span>PCR {fmt(chain.pcr, 2)}</span>}
                    {num(chain?.maxPain) != null && <span>max pain {fmt(chain.maxPain)}</span>}
                    {chain?.ageSec != null && (
                        <span className={chain.stale ? 'text-amber-400' : 'text-fg-6'}>
                            chain {chain.ageSec < 90 ? `${chain.ageSec}s` : `${Math.round(chain.ageSec / 60)}m`} old{chain.stale ? ' · ⚠ stale' : ''}
                        </span>
                    )}
                    <button onClick={loadChain} disabled={chainLoading}
                        className="px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-fg-3 hover:text-fg disabled:opacity-40">
                        {chainLoading ? 'loading…' : 'refresh chain'}
                    </button>
                </div>

                {chainErr && (
                    <div className="text-2xs text-red-300 mt-2 rounded border border-red-800/60 bg-red-950/20 p-2">
                        ✕ Chain unavailable — {chainErr}. You can still build: type strikes by hand and the server prices each leg live.
                    </div>
                )}
                {chainDead && (
                    <div className="text-2xs text-amber-300 mt-2 rounded border border-amber-700/50 bg-amber-950/15 p-2">
                        ⚠ No chain data for {shortSym(symbol)} — neither an archived snapshot nor a live broker chain came back.
                        The ladder has strikes but no premiums, IV, OI or greeks. Premiums are still fetched live when the structure is
                        analysed, so you can type strikes in by hand and it will price them.
                    </div>
                )}
                {chain?.expiryListed === false && (
                    <div className="text-2xs text-amber-300 mt-2 rounded border border-amber-700/50 bg-amber-950/15 p-2">
                        ⚠ <b>{chain.expiryRequested || chain.expiry}</b> is not an expiry the broker lists for {shortSym(symbol)}.
                        No contracts exist on that date, so nothing can be priced. Pick one from the Expiry dropdown —
                        {Array.isArray(chain.expiries) && chain.expiries.length
                            ? ` the nearest is ${chain.expiries[0].iso}.`
                            : ' the list is loading.'}
                    </div>
                )}
                {chain?.source === 'broker' && (
                    <div className="text-2xs text-sky-300/80 mt-2">
                        Chain read live from the broker — no archived snapshot covered this request. IV is derived from the
                        mid price rather than supplied, the per-strike greeks are computed from that IV, and open interest is the broker's live figure.
                    </div>
                )}
            </div>

            {/* ── TEMPLATE SEED ─────────────────────────────────────────── */}
            <div className="bg-slate-800/30 rounded-lg border border-line p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-fg-3 font-semibold">📐 Seed from a known structure</span>
                    <select value={tplKey} onChange={e => seedTemplate(e.target.value)}
                        disabled={!chain || !templates.length}
                        className="bg-slate-800 border border-line rounded p-1 text-fg-2 text-xs disabled:opacity-40">
                        <option value="">— pick a template —</option>
                        {templates.map(t => <option key={t.key} value={t.key}>{t.name} · {t.outlook}</option>)}
                    </select>
                    {tplKey && <button onClick={clearLegs} className="text-3xs text-fg-5 hover:text-fg-3">clear legs</button>}
                    {!chain && <span className="text-3xs text-fg-6">needs the chain (for ATM + strike step)</span>}
                </div>

                {/* Pull an existing deployment apart. LIVE first and marked —
                    real money should never be one row away from paper in a list
                    you are about to load and edit. */}
                <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    <span className="text-2xs text-fg-4">…or load a deployment</span>
                    <select value={depKey} onChange={e => loadDeployment(e.target.value)}
                        disabled={!deployments.length}
                        className="bg-slate-800 border border-line rounded p-1 text-fg-2 text-xs disabled:opacity-40 max-w-[22rem]">
                        <option value="">— pick a deployed strategy —</option>
                        {['LIVE', 'PAPER'].map(bookMode => {
                            const rows = deployments.filter(d => d.trade_mode === bookMode);
                            if (!rows.length) return null;
                            return (
                                <optgroup key={bookMode} label={`${bookMode} (${rows.length})`}>
                                    {rows.map(d => {
                                        const st = d.position?.state || 'IDLE';
                                        const open = ['OPEN', 'ENTERING', 'EXITING'].includes(st);
                                        return (
                                            <option key={d._id} value={String(d._id)}>
                                                {bookMode === 'LIVE' ? '💰 ' : ''}{d.name} · {open ? `${st} now` : st}
                                            </option>
                                        );
                                    })}
                                </optgroup>
                            );
                        })}
                    </select>
                    {depKey && (
                        <button onClick={() => { setDepKey(''); setDepNote(null); clearLegs(); }}
                            className="text-3xs text-fg-5 hover:text-fg-3">clear</button>
                    )}
                    {!deployments.length && <span className="text-3xs text-fg-6">no deployments found</span>}
                </div>
                {depNote && <div className="text-3xs text-sky-300/80 mt-1">{depNote}</div>}
                <div className="text-3xs text-fg-6 mt-1">
                    Template offsets are relative to ATM in strike steps, toward OTM. They are resolved to absolute strikes here — edit anything afterwards; the structure is no longer template-bound.
                </div>
                {seededFar && (
                    <div className="text-3xs text-amber-300 mt-1">⚠ This template has a FAR-expiry leg. A +7-day placeholder was seeded — set the real far expiry on that leg before trusting the numbers.</div>
                )}
            </div>

            {errorBanner}

            {/* ── WARNINGS ──────────────────────────────────────────────── */}
            {(resp?.warnings?.length || liq) && (
                <div className="space-y-1.5">
                    {(resp?.warnings || []).map((w, i) => {
                        const severe = /undefined maximum loss|ruinous|uncovered/i.test(w);
                        return (
                            <div key={i} className={`rounded-lg border p-2 text-2xs ${severe ? 'border-red-800/60 bg-red-950/20 text-red-200' : 'border-amber-700/50 bg-amber-950/15 text-amber-200'}`}>
                                {severe ? '⛔ ' : '⚠ '}{w}
                            </div>
                        );
                    })}
                    {liq && (
                        <div className={`rounded-lg border p-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${liq.grade === 'untradeable' || liq.grade === 'poor' ? 'border-red-800/60 bg-red-950/15' : 'border-line bg-slate-800/30'}`}>
                            <span className="text-2xs font-semibold text-fg-2">💸 Book cost<Help k="book-cost" /></span>
                            <span className={`text-3xs px-2 py-0.5 rounded border font-semibold uppercase ${GRADE_STYLE[liq.grade] || GRADE_STYLE.unknown}`}>{liq.grade || 'unknown'}</span>
                            <span className="text-3xs text-fg-4">worst leg half-spread<Help k="max-half-spread-pct" /> {pct(liq.worstHalfSpreadPct, 2)}</span>
                            <span className="text-3xs text-fg-4">round-trip {rup(liq.roundTripRupees)}</span>
                            <span className={`text-3xs ${num(liq.costPctOfGross) > 10 ? 'text-red-300' : 'text-fg-4'}`}>{pct(liq.costPctOfGross, 1)} of gross</span>
                            <span className="text-3xs text-fg-6">{GRADE_NOTE[liq.grade] || GRADE_NOTE.unknown}</span>
                        </div>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {/* ── LEG EDITOR ────────────────────────────────────────── */}
                <div className="bg-surface rounded-xl border border-line p-4">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <span className="text-sm font-semibold text-fg">Legs<Help k="leg-table" /> <span className="text-fg-5 font-normal text-2xs">{legs.length}/{MAX_LEGS}</span></span>
                        <div className="flex gap-1.5">
                            <button onClick={() => addLeg()} disabled={legs.length >= MAX_LEGS}
                                className="text-3xs px-2 py-0.5 rounded border border-primary/40 bg-primary/15 text-primary-ink hover:bg-primary/25 disabled:opacity-30">+ leg</button>
                            <button onClick={reverseAll} disabled={!legs.length} className={btnCls}
                                title="Flip every BUY to SELL and back — turns a structure into its mirror image">⇄ reverse all</button>
                            <button onClick={syncExpiries} disabled={!legs.length || !(chain?.expiry || expiry)} className={btnCls}
                                title="Set every leg to the selected expiry">sync expiries</button>
                            <button onClick={clearLegs} disabled={!legs.length}
                                className="text-3xs px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-fg-4 hover:text-red-300 disabled:opacity-30">clear</button>
                        </div>
                    </div>

                    {/* ── STRUCTURE ADJUSTERS ───────────────────────────── */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2 pb-2 border-b border-line-0 text-3xs">
                        <span className="text-fg-5">whole structure</span>
                        <button onClick={() => shiftAll(-1)} disabled={!distinctStrikes.length} className={btnCls}
                            title={`Shift DOWN — move EVERY leg one strike step (${fmt(step)} pts) lower. The shape is untouched; only where it sits against spot changes.`}>↓ shift</button>
                        <button onClick={() => shiftAll(1)} disabled={!distinctStrikes.length} className={btnCls}
                            title={`Shift UP — move EVERY leg one strike step (${fmt(step)} pts) higher. The shape is untouched; only where it sits against spot changes.`}>↑ shift</button>
                        <span className="text-fg-6">|</span>
                        <button onClick={() => changeWidth(-1)} disabled={!canWidth} className={btnCls}
                            title={canWidth
                                ? `Narrow — pull every leg one step (${fmt(step)} pts) TOWARD the structure's centre (${fmt(centreStrike)}). Tighter wings: less credit, less risk. No leg is allowed to cross the centre.`
                                : widthReason}>→← narrow</button>
                        <button onClick={() => changeWidth(1)} disabled={!canWidth} className={btnCls}
                            title={canWidth
                                ? `Widen — push every leg one step (${fmt(step)} pts) AWAY from the structure's centre (${fmt(centreStrike)}). Wider wings: more credit, more risk.`
                                : widthReason}>←→ widen</button>
                        {!canWidth && <span className="text-fg-6">width needs 2+ distinct strikes</span>}
                        <span className="text-fg-6">|</span>
                        <label className="flex items-center gap-1 text-fg-5"
                            title="Scale EVERY leg's ratio by this multiplier — 2× turns a 1:1 spread into 2:2. It is applied relative to whatever is already set, so returning to 1× restores the original ratios. To change SIZE without changing shape, use Lots at the top instead.">
                            ratio ×
                            <select value={ratioMult} onChange={e => applyMultiplier(num(e.target.value) || 1)}
                                disabled={!legs.length}
                                title="Multiply EVERY leg's ratio by this. Relative to what is already applied, so 1× puts the original ratios back. Shape, not size — for size use Lots."
                                className="bg-slate-800 border border-line rounded px-1 py-0.5 text-fg-3 disabled:opacity-30">
                                {RATIO_MULTIPLIERS.map(m => <option key={m} value={m}>{m}×</option>)}
                            </select>
                        </label>
                        <span className="text-fg-6">step {fmt(step)}</span>
                    </div>

                    {legs.length === 0 ? (
                        <div className="text-2xs text-fg-5 py-8 text-center border border-dashed border-line rounded-lg">
                            No legs yet. Click a strike in the ladder, seed a template, or press <span className="text-primary">+ leg</span>.
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {legs.map((l) => {
                                // resp.legs and analysis.perLeg are BOTH indexed by the
                                // request's leg order, which is validLegs — not the
                                // editor's row order.
                                const ri = validIndex.has(l.id) ? validIndex.get(l.id) : -1;
                                const rl = ri >= 0 ? (resp?.legs?.[ri] || null) : null;
                                const pl = ri >= 0 ? (an?.perLeg?.[ri] || null) : null;
                                const active = activeLegId === l.id;
                                return (
                                    <div key={l.id}
                                        onClick={() => setActiveLegId(l.id)}
                                        className={`rounded border p-1.5 cursor-pointer ${active ? 'border-primary/70 bg-primary/5' : 'border-line bg-slate-800/40'}`}>
                                        <div className="flex flex-wrap items-center gap-1">
                                            <button onClick={(e) => { e.stopPropagation(); patchLeg(l.id, { action: l.action === 'BUY' ? 'SELL' : 'BUY' }); }}
                                                className={`w-11 text-3xs py-1 rounded border font-semibold ${l.action === 'BUY' ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300' : 'border-red-700/60 bg-red-950/40 text-red-300'}`}>
                                                {l.action === 'BUY' ? 'BUY' : 'SELL'}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); patchLeg(l.id, { type: l.type === 'CE' ? 'PE' : 'CE', premium: '' }); }}
                                                className={`w-9 text-3xs py-1 rounded border font-semibold ${l.type === 'CE' ? 'border-sky-700/60 bg-sky-950/40 text-sky-300' : 'border-violet-700/60 bg-violet-950/40 text-violet-300'}`}>
                                                {l.type}
                                            </button>
                                            {/* STRIKE STEPPERS — one strike step per press, on the chain's own grid */}
                                            <button onClick={(e) => { e.stopPropagation(); bumpStrike(l.id, -1); }}
                                                className="text-2xs w-5 py-0.5 rounded border border-line-2 text-fg-4 hover:text-fg"
                                                title={`One strike step DOWN (−${fmt(step)} pts) — this leg only`}>−</button>
                                            <input type="number" value={l.strike} placeholder="strike"
                                                step={step}
                                                onChange={e => patchLeg(l.id, { strike: e.target.value, premium: '' })}
                                                className={`${cellCls} w-20`} title="Strike" />
                                            <button onClick={(e) => { e.stopPropagation(); bumpStrike(l.id, 1); }}
                                                className="text-2xs w-5 py-0.5 rounded border border-line-2 text-fg-4 hover:text-fg"
                                                title={`One strike step UP (+${fmt(step)} pts) — this leg only`}>+</button>
                                            <input type="number" min={1} value={l.ratio}
                                                onChange={e => patchLeg(l.id, { ratio: Math.max(1, num(e.target.value) || 1) })}
                                                className={`${cellCls} w-12`} title="Ratio — lots of THIS leg per lot of the structure" />
                                            <ExpiryPick value={l.expiry} chain={chain}
                                                onChange={v => patchLeg(l.id, { expiry: v, premium: '' })}
                                                className={`${cellCls} w-32`} title="Leg expiry" />
                                            <input type="number" step="0.05" value={l.premium}
                                                placeholder={num(rl?.premium) != null ? `${fmt(rl.premium, 2)} live` : 'live'}
                                                onChange={e => patchLeg(l.id, { premium: e.target.value })}
                                                className={`${cellCls} w-20`} title="Premium per unit. Blank = priced live by the server." />
                                            <div className="ml-auto flex gap-1">
                                                <button onClick={(e) => { e.stopPropagation(); dupLeg(l.id); }} disabled={legs.length >= MAX_LEGS}
                                                    className="text-3xs px-1.5 py-0.5 rounded border border-line-2 text-fg-4 hover:text-fg disabled:opacity-30" title="Duplicate this leg">⧉</button>
                                                <button onClick={(e) => { e.stopPropagation(); removeLeg(l.id); }}
                                                    className="text-3xs px-1.5 py-0.5 rounded border border-line-2 text-fg-4 hover:text-red-300" title="Remove this leg">✕</button>
                                            </div>
                                        </div>
                                        <div className="text-4xs font-mono text-fg-5 mt-1 flex flex-wrap gap-x-2">
                                            <span className="text-fg-4">{rl?.symbol || '—'}</span>
                                            {rl && (
                                                <>
                                                    <span>prem ₹{fmt(rl.premium, 2)}</span>
                                                    <span className={rl.premiumSource === 'user' ? 'text-amber-400' : rl.premiumSource === 'mid' ? 'text-emerald-400' : 'text-sky-400'}
                                                        title={rl.premiumSource === 'user' ? 'you pinned this price' : rl.premiumSource === 'mid' ? 'mid of the live bid/ask' : 'last traded price — no two-sided quote'}>
                                                        {rl.premiumSource || '—'}
                                                    </span>
                                                    {num(rl.bid) != null && <span>bid {fmt(rl.bid, 2)} / ask {fmt(rl.ask, 2)}</span>}
                                                    {num(pl?.timeValueUnit) != null && (
                                                        <span title="Per unit: intrinsic is the in-the-money part and cannot decay; time value is the part that does.">
                                                            int {fmt(pl.intrinsicUnit, 2)} · tv {fmt(pl.timeValueUnit, 2)}
                                                        </span>
                                                    )}
                                                    {num(pl?.greeks?.delta) != null && (
                                                        <span title="This leg's delta, already signed by BUY/SELL and scaled by its ratio — per unit.">
                                                            Δ {fmt(pl.greeks.delta, 3)}
                                                        </span>
                                                    )}
                                                    {l.premium === '' && num(rl.premium) > 0 && (
                                                        <button onClick={(e) => { e.stopPropagation(); patchLeg(l.id, { premium: String(rl.premium) }); }}
                                                            className="text-fg-5 hover:text-amber-300" title="Pin this price so the analysis stops re-fetching it">📌 pin</button>
                                                    )}
                                                </>
                                            )}
                                            {!rl && !loading && <span className="text-fg-6">not priced yet</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {legs.length >= MAX_LEGS && <div className="text-3xs text-amber-400 mt-1.5">Leg cap reached — the server refuses more than {MAX_LEGS}.</div>}

                    {/* SAVE */}
                    <div className="mt-3 pt-2.5 border-t border-line-0 flex flex-wrap items-center gap-2">
                        <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="name this structure"
                            className="bg-slate-800 border border-line rounded p-1.5 text-fg-2 text-xs flex-1 min-w-[10rem]" />
                        <button onClick={save} disabled={saving || !validLegs.length}
                            className="text-2xs px-3 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary-ink hover:bg-primary/25 disabled:opacity-30">
                            {saving ? 'saving…' : '💾 Save structure'}
                        </button>
                        {saveState && <span className={`text-3xs ${saveState.ok ? 'text-emerald-300' : 'text-red-300'}`}>{saveState.msg}</span>}
                    </div>
                    <div className="text-4xs text-fg-6 mt-1">Saved as a <span className="font-mono">custom</span> structure with absolute strikes — it is a snapshot of these legs, not a relative recipe that re-centres on a future ATM.</div>
                </div>

                {/* ── STRIKE LADDER ─────────────────────────────────────── */}
                <ChainLadder
                    chain={chain} chainLoading={chainLoading} chainErr={chainErr} symbol={symbol}
                    legs={validLegs}
                    view={chainView} onView={setChainView}
                    activeLegId={activeLegId}
                    hasActiveLeg={!!activeLegId && legs.some(l => l.id === activeLegId)}
                    onClearActive={() => setActiveLegId(null)}
                    pickAction={pickAction} onPickAction={setPickAction}
                    count={count} onCount={setCount}
                    onPick={pickStrike} atmRowRef={atmRowRef}
                />
            </div>

            {/* ── ANALYSIS TABS — payoff / P&L table / per-leg greeks / legs ── */}
            <AnalysisTabs
                an={an} resp={resp} chain={chain}
                chartData={chartData} hasNow={hasNow} hasWif={hasWif} wif={wif}
                spot={spot} yDomain={yDomain} xTicks={xTicks} strikeMarks={strikeMarks}
                lots={body.lots} lotSize={lotSize}
                loading={loading} err={err} legCount={validLegs.length}
                sdMode={sdMode} onSdMode={setSdMode}
            />

            {/* ── STATS ─────────────────────────────────────────────────── */}
            <div className="bg-surface rounded-xl border border-line p-4">
                <div className="text-sm font-semibold text-fg mb-2">Structure</div>
                {!an ? (
                    <div className="text-2xs text-fg-5 py-6 text-center">{loading ? 'analysing…' : 'no analysis yet'}</div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
                            <Tile label={an.isCredit ? 'Net CREDIT' : 'Net DEBIT'} help="net-credit-debit"
                                value={`₹${fmt(Math.abs(num(an.netPremiumUnit)), 2)}/u`}
                                sub={rup(Math.abs(num(an.netPremiumRupees)))}
                                good={an.isCredit} warn={!an.isCredit} />
                            <Tile label="Max profit" help="max-profit"
                                value={an.unboundedProfit ? 'UNBOUNDED' : `₹${fmt(an.maxProfitUnit, 2)}/u`}
                                sub={an.unboundedProfit ? 'no ceiling' : rup(an.maxProfitRupees)}
                                good />
                            {/* UNBOUNDED, never a number: maxLoss is null when the payoff has an
                                uncovered short. Printing the worst value sampled off the plot
                                window would put a comforting, finite, and WRONG floor on a
                                position whose real floor does not exist. */}
                            <Tile label="Max loss" help="max-loss"
                                value={an.unbounded ? 'UNBOUNDED' : `₹${fmt(Math.abs(num(an.maxLossUnit)), 2)}/u`}
                                sub={an.unbounded ? 'uncovered short leg' : rup(Math.abs(num(an.maxLossRupees)))}
                                bad />
                            <Tile label="Breakevens" help="breakeven"
                                value={(an.breakevens || []).length ? an.breakevens.map(b => fmt(b)).join(' / ') : '—'}
                                sub={spot > 0 && (an.breakevens || []).length ? an.breakevens.map(b => `${num(b) > spot ? '+' : '−'}${fmt(Math.abs(num(b) - spot))}`).join(' / ') : null} />
                            <Tile label="POP" help="pop"
                                value={pct(an.pop, 1)}
                                good={num(an.pop) >= 60} bad={num(an.pop) != null && num(an.pop) < 40} />
                            <Tile label="Risk : reward"
                                title="max loss ÷ max profit, both at expiry. Undefined when either side is unbounded."
                                value={num(an.riskReward) != null ? `${fmt(an.riskReward, 2)} : 1` : '—'} />
                            {/* INTRINSIC vs TIME VALUE — both signed BY POSITION, so a net
                                seller reads a POSITIVE time value: that is the money decay
                                pays you. Intrinsic is the part the market has already taken
                                and that no amount of waiting can decay back. */}
                            <Tile label="Intrinsic value"
                                title="The in-the-money part of the structure's premium, signed by how you hold it. It does not decay — only a spot move changes it."
                                value={num(an.intrinsicUnit) != null ? `${sgn(an.intrinsicUnit, 2)}/u` : '—'}
                                sub={num(an.intrinsicRupees) != null ? sgn(an.intrinsicRupees) : null} />
                            <Tile label="Time value"
                                title="The decaying part of the premium, signed by how you hold it. Positive = you are the one being paid to wait; negative = you paid for time and theta is against you."
                                value={num(an.timeValueUnit) != null ? `${sgn(an.timeValueUnit, 2)}/u` : '—'}
                                sub={num(an.timeValueRupees) != null ? sgn(an.timeValueRupees) : null}
                                good={num(an.timeValueUnit) > 0} bad={num(an.timeValueUnit) < 0} />
                            <Tile label="Expected move (±1σ)" help="expected-move"
                                value={num(an.expectedMove) != null ? `±${fmt(an.expectedMove)} pts` : '—'}
                                sub={num(an.expectedMove) != null && spot > 0 ? `${fmt(spot - an.expectedMove)} – ${fmt(spot + an.expectedMove)}` : null} />
                            <Tile label="Margin (est)" help="margin"
                                value={rup(resp?.margin?.rupees)}
                                sub={resp?.margin ? `${resp.margin.basis} · ${fmt(resp.margin.shortLots)} short lot(s)${resp.margin.hedged ? ' · hedged' : ''}` : null} />
                            <Tile label="Round-trip charges" help="mtm-charges"
                                value={rup(chargesRupees, 0)}
                                warn={chargesHeavy}
                                sub={chargePctOfBest != null ? `${pct(chargePctOfBest, 1)} of best case` : null} />
                            {/* Two day-counts, both named. The pricing/greeks above used the
                                TRADING-time one; every broker screen shows the calendar one. */}
                            <Tile label="DTE (trading-time)"
                                title="Trading-time days to the nearest expiry — what the pricing kernel and the greeks above actually used. A weekend decays far less than two days."
                                value={num(an.dte) != null ? `${fmt(an.dte, 2)} d` : '—'} />
                            <Tile label="DTE (calendar)" help="dte"
                                title="Wall-clock days to the nearest expiry — what your broker screen shows."
                                value={num(an.dteCalendar) != null ? `${fmt(an.dteCalendar, 2)} d` : '—'}
                                sub={an.nearestExpiry || null} />
                        </div>
                        <div className="text-4xs text-fg-6 mt-1.5">
                            Per-unit (&quot;/u&quot;) and rupee figures are the same number in different units<Help k="per-unit-vs-rupees" /> — ×{fmt(lotSize)} lot size ×{fmt(body.lots)} lots. All gross.
                        </div>

                        {/* ── STANDARD-DEVIATION LEVELS ─────────────────── */}
                        {sd.levels.length > 0 && (
                            <div className="mt-2.5 rounded-lg border border-line-0 bg-slate-800/30 p-2.5">
                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                    <span className="text-2xs font-semibold text-fg-2">Standard-deviation levels</span>
                                    {['calendar', 'trading'].map(m => (
                                        <button key={m} onClick={() => setSdMode(m)} title={SD_HORIZON_NOTE[m]}
                                            className={`text-3xs px-1.5 py-0.5 rounded border ${sdMode === m
                                                ? 'border-violet-600 bg-violet-950/40 text-violet-200'
                                                : 'border-line bg-slate-800 text-fg-5 hover:text-fg-3'}`}>{m}</button>
                                    ))}
                                    <span className="text-4xs text-fg-5">
                                        showing <span className="text-violet-300">{sd.horizon === 'calendar' ? 'CALENDAR' : 'TRADING-TIME'}</span> — {SD_HORIZON_NOTE[sd.horizon]}
                                        {sd.horizon !== sdMode ? ' (the horizon you picked was unavailable)' : ''}
                                    </span>
                                </div>
                                <table className="text-3xs font-mono">
                                    <thead>
                                        <tr className="text-fg-6 text-4xs">
                                            <th className="font-normal text-left pr-4">SD</th>
                                            <th className="font-normal text-right px-3">points</th>
                                            <th className="font-normal text-right px-3">% of spot</th>
                                            <th className="font-normal text-right px-3">down</th>
                                            <th className="font-normal text-right px-3">up</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sd.levels.map(b => (
                                            <tr key={`sd${b.sd}`} className="border-t border-line-0/60">
                                                <td className="text-fg-3 pr-4">±{fmt(b.sd)}σ</td>
                                                <td className="text-right text-fg-3 px-3">{fmt(b.points, 1)}</td>
                                                <td className="text-right text-fg-4 px-3">{pct(b.pct, 1)}</td>
                                                <td className="text-right text-red-300 px-3">{fmt(b.down)}</td>
                                                <td className="text-right text-emerald-300 px-3">{fmt(b.up)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="text-4xs text-fg-6 mt-1">
                                    The move the market is pricing between now and the nearest expiry, at this IV. Roughly 68% of outcomes land inside ±1σ and 95% inside ±2σ — IF the IV being used is right, which is exactly the assumption a short structure is making.
                                </div>
                            </div>
                        )}

                        {/* ── CHARGES BREAKDOWN ─────────────────────────── */}
                        <button type="button" onClick={() => setChargesOpen(o => !o)}
                            className={`mt-2.5 w-full text-left rounded-lg border p-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${chargesHeavy ? 'border-amber-700/50 bg-amber-950/15' : 'border-line-0 bg-slate-800/30'}`}>
                            <span className="text-2xs font-semibold text-fg-2">{chargesOpen ? '▾' : '▸'} 💸 Round-trip charges (estimate)</span>
                            <span className={`text-2xs font-semibold ${chargesHeavy ? 'text-amber-300' : 'text-fg-3'}`}>{rup(chargesRupees, 0)}</span>
                            <span className={`text-3xs ${chargesHeavy ? 'text-amber-300' : 'text-fg-5'}`}>
                                {chargePctOfBest != null ? `${pct(chargePctOfBest, 1)} of max profit`
                                    : an.unboundedProfit ? 'max profit is unbounded — no percentage to compare against'
                                        : 'no positive best case to compare against'}
                            </span>
                            {chargesHeavy && <span className="text-3xs text-amber-300">⚠ more than a quarter of everything this structure can make</span>}
                        </button>
                        {chargesOpen && (
                            <div className="text-3xs text-fg-4 rounded-b-lg border border-t-0 border-line-0 bg-slate-900/40 p-2.5 space-y-1">
                                <div>
                                    This is an <span className="text-fg-2">estimate of the FULL round trip</span> — opening AND closing all {fmt(validLegs.length)} leg(s), i.e. {fmt(validLegs.length * 2)} orders — costed at the current rate card:
                                    ₹20 brokerage per order, 0.0625% STT on the sell side, ~0.035% exchange fee, 18% GST on brokerage + exchange fee, SEBI turnover fee and stamp duty.
                                </div>
                                <div>
                                    Half of it (the entry side) is spent the moment the structure is opened and cannot be avoided by holding on. Every other number on this page is GROSS, so this is the money standing between them and what you actually keep.
                                </div>
                                <div className={chargesHeavy ? 'text-amber-300' : 'text-fg-5'}>
                                    {chargePctOfBest != null
                                        ? `Max profit ${rup(bestCase)} · charges ${rup(chargesRupees, 0)} = ${pct(chargePctOfBest, 1)} of it.${chargesHeavy ? ' That is past the 25% line where costs stop being a rounding error and start being the trade.' : ''}`
                                        : an.unboundedProfit
                                            ? 'Max profit is unbounded here, so there is no ceiling to take a percentage of — judge the cost against the net credit instead.'
                                            : 'No positive best case was computed, so there is nothing to take a percentage of.'}
                                </div>
                                {liq && num(liq.roundTripRupees) != null && (
                                    <div className="text-fg-5">
                                        Separately, crossing the bid/ask both ways costs about {rup(liq.roundTripRupees)} ({pct(liq.costPctOfGross, 1)} of gross). Charges and spread are different money and both are real.
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── GREEKS (BOOK) ─────────────────────────────────────────── */}
            <div className="bg-surface rounded-xl border border-line p-4">
                <div className="text-sm font-semibold text-fg mb-2">Greeks<Help k="book-greeks" /> <span className="text-fg-5 font-normal text-2xs">— the whole structure at {fmt(body.lots)} lot(s), in RUPEES. The per-leg breakdown (in option units) is in the Greeks tab above.</span></div>
                {!an?.greeks ? (
                    <div className="text-2xs text-fg-5 py-4 text-center">
                        {an ? 'No greeks — implied volatility could not be established for these legs (supply an IV override above).' : loading ? 'analysing…' : 'no analysis yet'}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                        <Tile label="Delta (₹/pt)" help="delta"
                            value={sgn(an.greeks.delta, 1)}
                            good={num(an.greeks.delta) > 0} bad={num(an.greeks.delta) < 0}
                            title="Rupees gained per 1-point rise in the index." />
                        <Tile label="Gamma" help="gamma"
                            value={num(an.greeks.gamma) != null ? fmt(an.greeks.gamma, 4) : '—'}
                            title="How fast delta itself changes as spot moves." />
                        <Tile label="Vega (₹/IV-pt)" help="vega"
                            value={sgn(an.greeks.vega, 1)}
                            good={num(an.greeks.vega) > 0} bad={num(an.greeks.vega) < 0}
                            title="Rupees gained per 1-point rise in implied volatility. Negative = short vol." />
                        <Tile label="Theta (₹/day)" help="theta"
                            value={sgn(an.greeks.theta, 1)}
                            good={num(an.greeks.theta) > 0} bad={num(an.greeks.theta) < 0}
                            title="Rupees gained per day of decay, holding everything else still." />
                        <Tile label="Delta units"
                            value={num(an.greeks.deltaUnits) != null ? fmt(an.greeks.deltaUnits, 2) : '—'}
                            title="Net option delta in UNITS (per-lot, unscaled by lot size) — the directional exposure the risk gates measure. ~0 means the structure is delta-neutral." />
                    </div>
                )}
            </div>

            {/* ── WHAT-IF ───────────────────────────────────────────────── */}
            <div className="bg-surface rounded-xl border border-line p-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-sm font-semibold text-fg">🔮 What-if <span className="text-fg-5 font-normal text-2xs">— same structure, different world</span></span>
                    <label className="flex items-center gap-1.5 text-2xs text-fg-4">
                        <input type="checkbox" checked={wifOn} onChange={e => setWifOn(e.target.checked)} className="accent-fuchsia-500" />
                        overlay on the chart
                    </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-2xs">
                    <label className="text-fg-4">
                        <div className="flex justify-between">
                            <span>Spot {wifSpotPct >= 0 ? '+' : '−'}{Math.abs(wifSpotPct).toFixed(1)}%</span>
                            <span className="text-fuchsia-300 font-mono">{anchorSpot > 0 ? fmt(Math.round(anchorSpot * (1 + wifSpotPct / 100))) : '—'}</span>
                        </div>
                        <input type="range" min={-5} max={5} step={0.1} value={wifSpotPct}
                            onChange={e => { setWifSpotPct(num(e.target.value) || 0); setWifOn(true); }}
                            disabled={!(anchorSpot > 0)} className="w-full accent-fuchsia-500" />
                    </label>
                    <label className="text-fg-4">
                        <div className="flex justify-between">
                            <span>IV shift {wifIvShift >= 0 ? '+' : '−'}{Math.abs(wifIvShift).toFixed(1)} pts</span>
                            <span className="text-fuchsia-300 font-mono">{num(wif?.ivPct) != null ? `${fmt(wif.ivPct, 2)}%` : num(an?.ivUsed) != null ? `${fmt(an.ivUsed, 2)}%` : '—'}</span>
                        </div>
                        <input type="range" min={-10} max={10} step={0.5} value={wifIvShift}
                            onChange={e => { setWifIvShift(num(e.target.value) || 0); setWifOn(true); }}
                            className="w-full accent-fuchsia-500" />
                    </label>
                    <label className="text-fg-4">
                        <div className="flex justify-between">
                            <span>Days forward {fmt(wifDays, 1)}</span>
                            <span className="text-fg-5 font-mono">of {num(an?.dteCalendar) != null ? `${fmt(an.dteCalendar, 1)} cal` : '—'}</span>
                        </div>
                        <input type="range" min={0} max={Math.max(1, Math.ceil(num(an?.dteCalendar) || 1))} step={0.5} value={wifDays}
                            onChange={e => { setWifDays(num(e.target.value) || 0); setWifOn(true); }}
                            className="w-full accent-fuchsia-500" />
                    </label>
                </div>
                <div className="text-4xs text-fg-6 mt-1">Days forward is CALENDAR time — a weekend ages the position without a single tick, and the slider stops at the nearest expiry.</div>

                {wifOn && (
                    <div className="mt-3">
                        {!wif ? (
                            <div className="text-2xs text-fg-5 py-3 text-center">{loading ? 'computing the what-if…' : 'move a slider to compute a what-if'}</div>
                        ) : (
                            <>
                                <div className="text-3xs text-fuchsia-300 mb-1.5">
                                    at spot {fmt(wif.spot)} · IV {pct(wif.ivPct, 2)} · +{fmt(wif.daysForward, 1)} calendar day(s) — deltas are versus the base case
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
                                    <DeltaTile label="Max profit" base={an?.maxProfitRupees} now={wif.maxProfitRupees} money
                                        unboundedNow={wif.unboundedProfit} unboundedBase={an?.unboundedProfit} />
                                    <DeltaTile label="Max loss" base={an?.maxLossRupees} now={wif.maxLossRupees} money
                                        unboundedNow={wif.unbounded} unboundedBase={an?.unbounded} />
                                    <DeltaTile label="POP" base={an?.pop} now={wif.pop} suffix="%" digits={1} />
                                    <DeltaTile label="Expected move" base={an?.expectedMove} now={wif.expectedMove} suffix=" pts" />
                                    <DeltaTile label="Delta ₹/pt" base={an?.greeks?.delta} now={wif.greeks?.delta} digits={1} money />
                                    <DeltaTile label="Theta ₹/day" base={an?.greeks?.theta} now={wif.greeks?.theta} digits={1} money />
                                    <DeltaTile label="Vega ₹/IV-pt" base={an?.greeks?.vega} now={wif.greeks?.vega} digits={1} money />
                                    <Tile label="What-if breakevens"
                                        value={(wif.breakevens || []).length ? wif.breakevens.map(b => fmt(b)).join(' / ') : '—'} />
                                    <Tile label="P&L at that spot"
                                        title="Where the fuchsia curve sits at the what-if spot — the structure's mark-to-market in that world, gross."
                                        value={rup(interpAt(wif.curve || [], num(wif.spot), (wif.curve || []).some(p => num(p.now) != null) ? 'now' : 'expiry'))}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** A stat with its change versus the base case. `unbounded*` flags win over any
 *  number: a bounded→unbounded transition is the single most important thing a
 *  what-if can reveal, and it has no numeric delta. */
function DeltaTile({ label, base, now, digits = 0, suffix = '', money = false, unboundedBase = false, unboundedNow = false }) {
    const b = num(base), n = num(now);
    const val = unboundedNow ? 'UNBOUNDED' : n == null ? '—' : money ? rup(n, digits) : `${fmt(n, digits)}${suffix}`;
    let delta = null;
    if (!unboundedNow && !unboundedBase && b != null && n != null) {
        const d = n - b;
        delta = `${d > 0 ? '+' : d < 0 ? '−' : '±'}${money ? '₹' : ''}${fmt(Math.abs(d), digits)}${money ? '' : suffix}`;
    } else if (unboundedNow && !unboundedBase) {
        delta = 'became unbounded';
    } else if (!unboundedNow && unboundedBase) {
        delta = 'now bounded';
    }
    const dir = (!unboundedNow && !unboundedBase && b != null && n != null) ? Math.sign(n - b) : 0;
    return (
        <div className="bg-slate-800/60 border border-line rounded p-2">
            <div className="text-3xs text-fg-5">{label}</div>
            <div className={`text-sm font-semibold ${unboundedNow ? 'text-red-300' : 'text-fg-2'}`}>{val}</div>
            {delta && <div className={`text-4xs font-mono mt-0.5 ${dir > 0 ? 'text-emerald-400' : dir < 0 ? 'text-red-400' : 'text-fg-5'}`}>{delta}</div>}
        </div>
    );
}
