/**
 * Go-live building blocks shared by the Go-Live page, the Deployments panel and the
 * Multi-leg page: the gate list and the promotion dialog. The rules themselves live
 * in the backend (src/domain/golive/gates.js); this only shows them and collects the
 * operator's decision.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Modal, StatusBadge, Chip, Spinner } from '../viz/primitives';
import { inr } from '../viz/tokens';
import { GOLIVE, errText, OVERRIDE_PHRASE, gateBadge } from './goLiveApi.js';

const GROUP_LABEL = {
    venue: 'Broker connection',
    drill: 'Broker drill (real order path)',
    evidence: 'Evidence the strategy makes money',
    risk: 'Risk limits',
    system: 'System health',
};
const GROUP_ORDER = ['venue', 'drill', 'evidence', 'risk', 'system'];
const LEVEL_CHIP = {
    hard: { tone: 'critical', text: 'must pass', title: 'Cannot be overridden — the order path is unproven or broken' },
    soft: { tone: 'warning', text: 'evidence', title: 'Can be overridden with a written reason, recorded with the promotion' },
    info: { tone: 'muted', text: 'info', title: 'Shown, never blocking' },
};

/** Gates grouped, failures first inside each group. `onlyProblems` hides passes. */
export function GateList({ gates = [], onlyProblems = false }) {
    const groups = GROUP_ORDER
        .map((grp) => ({ grp, rows: gates.filter((g) => g.group === grp && (!onlyProblems || g.status !== 'pass')) }))
        .filter((x) => x.rows.length);
    if (!groups.length) return <p className="text-xs text-fg-5">{onlyProblems ? 'Every gate passes.' : 'No gates.'}</p>;
    const rank = (g) => ({ critical: 0, warning: 1, info: 2, good: 3 }[gateBadge(g).level]);
    return (
        <div className="space-y-3">
            {groups.map(({ grp, rows }) => (
                <section key={grp} aria-label={GROUP_LABEL[grp]}>
                    <h3 className="text-2xs uppercase tracking-wide text-fg-5 mb-1">{GROUP_LABEL[grp]}</h3>
                    <ul className="space-y-1.5">
                        {[...rows].sort((a, b) => rank(a) - rank(b)).map((g) => {
                            const b = gateBadge(g);
                            const lv = LEVEL_CHIP[g.level] || LEVEL_CHIP.info;
                            return (
                                <li key={g.id} className="border border-line/50 rounded px-2.5 py-1.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <StatusBadge level={b.level}>{b.text}</StatusBadge>
                                        <span className="text-xs font-medium text-fg-2">{g.title}</span>
                                        <Chip tone={lv.tone} title={lv.title}>{lv.text}</Chip>
                                    </div>
                                    <div className="text-2xs text-fg-4 mt-0.5">
                                        <span className="text-fg-3">{g.have}</span>
                                        {g.need ? <span className="text-fg-5"> · needs {g.need}</span> : null}
                                    </div>
                                    {g.fix && <div className="text-2xs text-fg-3 mt-0.5">→ {g.fix}</div>}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </div>
    );
}

/** One line: what blocks, what needs an override, what is only a warning. */
export function ReadinessLine({ summary }) {
    if (!summary) return null;
    const c = summary.counts || {};
    if (summary.ready) return <StatusBadge level="good">ready — {c.pass}/{c.total} gates pass</StatusBadge>;
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {c.hard > 0 && <StatusBadge level="critical">{c.hard} blocking</StatusBadge>}
            {c.soft > 0 && <StatusBadge level="warning">{c.soft} evidence {c.soft === 1 ? 'gap' : 'gaps'}</StatusBadge>}
            {c.warn > 0 && <StatusBadge level="info">{c.warn} warning{c.warn === 1 ? '' : 's'}</StatusBadge>}
        </span>
    );
}

const field = 'w-full bg-slate-900 border border-line rounded p-1.5 text-fg text-sm';

/**
 * The PAPER → LIVE dialog. Loads the deployment's report, shows every gate that is
 * not passing, collects the canary settings and — only when evidence gates fail and
 * nothing hard does — the override phrase and a reason.
 *
 * @param kind    'single' | 'multileg'
 * @param onClose cancelled (the deployment stays PAPER)
 * @param onDone  promoted — receives { deployment, canary, decision }; the caller closes the dialog
 */
export function PromoteDialog({ open, kind, id, name, onClose, onDone }) {
    const [state, setState] = useState({ key: null, report: null, error: null });
    const [showAll, setShowAll] = useState(false);
    const [form, setForm] = useState({ trades: '', lots: '', lossCapInr: '', phrase: '', reason: '' });
    const [busy, setBusy] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const key = open ? `${kind}:${id}` : null;

    useEffect(() => {
        if (!key) return undefined;
        let alive = true;
        axios.get(`${GOLIVE}/deployments/${kind}/${id}`)
            .then((r) => { if (alive) setState({ key, report: r.data, error: null }); })
            .catch((e) => { if (alive) setState({ key, report: null, error: errText(e) }); });
        return () => { alive = false; };
    }, [key, kind, id]);

    const cur = state.key === key ? state : null;
    const report = cur?.report || null;
    const s = report?.summary;
    const def = report?.canaryDefaults || { trades: 10, lots: 1, lossCapInr: 5000 };
    const needsOverride = !!(s && !s.ready && s.overridable);
    const blocked = !!(s && s.hard && s.hard.length);
    const phraseOk = form.phrase.trim().toUpperCase() === OVERRIDE_PHRASE;
    const reasonOk = form.reason.trim().length >= 10;
    const canSubmit = !!report && !blocked && (!needsOverride || (phraseOk && reasonOk)) && !busy;
    const shown = useMemo(() => (report ? report.gates : []), [report]);

    const reset = () => {
        setForm({ trades: '', lots: '', lossCapInr: '', phrase: '', reason: '' });
        setSubmitError(null); setShowAll(false); setBusy(false);
    };
    // Cancel → onClose. Success → onDone only (the caller closes it): a success is not a cancel.
    const close = () => { reset(); onClose?.(); };

    const submit = async () => {
        setBusy(true); setSubmitError(null);
        try {
            const body = {
                canary: { trades: form.trades || undefined, lots: form.lots || undefined, lossCapInr: form.lossCapInr || undefined },
                ...(needsOverride ? { override: { phrase: form.phrase, reason: form.reason } } : {}),
            };
            const r = await axios.post(`${GOLIVE}/deployments/${kind}/${id}/promote`, body);
            reset();
            onDone?.(r.data);
        } catch (e) {
            setSubmitError(errText(e));
            if (e?.response?.data?.report) setState({ key, report: e.response.data.report, error: null });
            setBusy(false);
        }
    };

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const title = `Promote to LIVE — ${name || report?.name || ''}`;
    return (
        <Modal open={open} onClose={close} title={title} docs="go-live#promote" width="max-w-2xl" footer={(
            <>
                <button type="button" onClick={close} className="px-3 py-1.5 rounded text-xs text-fg-3 border border-line">Cancel</button>
                <button type="button" onClick={submit} disabled={!canSubmit}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-danger-fill text-white disabled:opacity-40">
                    {busy ? 'Promoting…' : 'Promote to LIVE (real money)'}
                </button>
            </>
        )}>
            {!cur && <Spinner label="Checking every gate…" />}
            {cur?.error && <p className="text-xs text-danger">{cur.error}</p>}
            {report && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-fg-3">{report.symbol}</span>
                        {report.strategy && <Chip>{report.strategy}</Chip>}
                        <Chip tone="info">{report.venue}{report.segment ? ` · ${report.segment}` : ''}</Chip>
                        <ReadinessLine summary={s} />
                    </div>
                    {blocked && (
                        <p className="text-xs text-danger">
                            {s.hard.length} gate{s.hard.length === 1 ? '' : 's'} must pass first — these cannot be overridden, because the orders would fail or run unprotected.
                        </p>
                    )}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <h3 className="text-xs font-semibold text-fg-2">{showAll ? 'Every gate' : 'What is not passing'}</h3>
                            <button type="button" className="text-2xs text-primary-ink underline" onClick={() => setShowAll((v) => !v)}>
                                {showAll ? 'show only problems' : `show all ${shown.length}`}
                            </button>
                        </div>
                        <GateList gates={shown} onlyProblems={!showAll} />
                    </div>

                    {!blocked && (
                        <fieldset className="border border-line/60 rounded p-3 space-y-2">
                            <legend className="text-xs font-semibold text-fg-2 px-1">Canary — the first live trades</legend>
                            <p className="text-2xs text-fg-5">
                                The first trades run at a capped size. If they lose more than the cap you get an urgent alert and decide here —
                                demote to PAPER or keep it LIVE. Nothing switches by itself; it keeps trading LIVE at the canary size until you answer.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <label className="text-2xs text-fg-4">Trades<input type="number" min="1" step="1" className={field} placeholder={String(def.trades)} value={form.trades} onChange={set('trades')} /></label>
                                <label className="text-2xs text-fg-4">Lots (deployment: {report.lots})<input type="number" min="1" max={report.lots} step="1" className={field} placeholder={String(def.lots)} value={form.lots} onChange={set('lots')} /></label>
                                <label className="text-2xs text-fg-4">Loss cap ₹<input type="number" min="1" step="100" className={field} placeholder={String(def.lossCapInr)} value={form.lossCapInr} onChange={set('lossCapInr')} /></label>
                            </div>
                            <p className="text-2xs text-fg-5">
                                Empty fields use the defaults: {def.trades} trades at {def.lots} lot(s), cap {inr(def.lossCapInr)}. Lots can never exceed the deployment's {report.lots}.
                            </p>
                        </fieldset>
                    )}

                    {needsOverride && (
                        <fieldset className="border border-warning/40 rounded p-3 space-y-2">
                            <legend className="text-xs font-semibold text-warning px-1">Override the evidence gates</legend>
                            <p className="text-2xs text-fg-4">
                                The evidence does not show this strategy makes money. Promoting anyway is your call — it is recorded with the promotion.
                                Type <span className="font-mono text-fg-2">{OVERRIDE_PHRASE}</span> and say why.
                            </p>
                            <label className="block text-2xs text-fg-4">Phrase
                                <input className={field} value={form.phrase} onChange={set('phrase')} aria-invalid={form.phrase ? !phraseOk : undefined} autoComplete="off" />
                            </label>
                            <label className="block text-2xs text-fg-4">Reason (10+ characters)
                                <textarea rows={2} className={field} value={form.reason} onChange={set('reason')} />
                            </label>
                        </fieldset>
                    )}
                    {submitError && <p className="text-xs text-danger" role="alert">{submitError}</p>}
                </div>
            )}
        </Modal>
    );
}
