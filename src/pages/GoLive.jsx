/**
 * Go Live — the one place a deployment starts trading real money.
 *
 *   1. Broker connection   — login, funds, IP whitelist, order socket (per venue)
 *   2. Broker drill        — a real order that cannot fill, placed → modified → cancelled,
 *                            per segment (NSE options, BSE options, MCX futures, Delta)
 *   3. Evidence            — the deployment's own backtest (held-out 30%) and paper record
 *   4. Promote             — with a canary: the first live trades at a capped size,
 *                            demoted to PAPER automatically past a loss cap
 *
 * Every rule is evaluated by the backend (/api/golive); this page shows the gates,
 * runs drills only when asked, and collects the promotion decision.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Rocket, RefreshCw, ShieldAlert, FlaskConical } from 'lucide-react';
import { PageHeader, Card, StatRow, StatTile, DataTable, Chip, ModeChip, StatusBadge, Spinner, Modal, Segmented, EmptyState, SkeletonTiles } from '../components/viz/primitives';
import { inr, istDateTime } from '../components/viz/tokens';
import { toast } from '../components/toastStore.js';
import { useConfirm } from '../components/confirmContext.js';
import { GateList, ReadinessLine, PromoteDialog } from '../components/golive/goLiveShared.jsx';
import { GOLIVE, errText } from '../components/golive/goLiveApi.js';
import DocLink from '../components/DocLink.jsx';

const VENUE_NAME = { FYERS: 'Fyers', DELTA: 'Delta Exchange' };
const SEGMENTS_OF = { FYERS: ['NSE-OPT', 'BSE-OPT', 'MCX-FUT'], DELTA: ['DELTA'] };
const SEGMENT_NAME = { 'NSE-OPT': 'NSE options', 'BSE-OPT': 'BSE options', 'MCX-FUT': 'MCX futures', DELTA: 'Delta perpetuals' };

const when = (iso) => (iso ? istDateTime(iso) : '—');

// ── broker drill: confirm, run, show the steps ───────────────────────────
function DrillDialog({ plan, running, result, onRun, onClose }) {
    return (
        <Modal docs="go-live#drills" open={!!plan} onClose={running ? undefined : onClose} title={plan ? `Broker drill — ${SEGMENT_NAME[plan.segment] || plan.segment}` : ''} width="max-w-xl"
            footer={result ? (
                <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-xs text-fg-3 border border-line">Close</button>
            ) : (
                <>
                    <button type="button" onClick={onClose} disabled={running} className="px-3 py-1.5 rounded text-xs text-fg-3 border border-line disabled:opacity-40">Cancel</button>
                    <button type="button" onClick={onRun} disabled={running || (plan && plan.available === false)} className="px-3 py-1.5 rounded text-xs font-semibold bg-danger-fill text-white disabled:opacity-40">
                        {running ? 'Sending…' : 'Send the drill order'}
                    </button>
                </>
            )}>
            {plan && !result && (
                <div className="space-y-2 text-xs">
                    {plan.available === false && <StatusBadge level="warning">Not possible right now</StatusBadge>}
                    {plan.available === false && <p className="text-warning">{plan.unavailableReason}</p>}
                    <p className="text-fg-3">This sends a <strong className="text-fg">real order</strong> to your account, built so the market cannot fill it:</p>
                    <dl className="space-y-1.5">
                        <div><dt className="text-2xs uppercase tracking-wide text-fg-5">Account</dt><dd className="text-fg-2">{plan.env}</dd></div>
                        <div><dt className="text-2xs uppercase tracking-wide text-fg-5">Instrument</dt><dd className="text-fg-2">{plan.instrument}</dd></div>
                        <div><dt className="text-2xs uppercase tracking-wide text-fg-5">Order</dt><dd className="text-fg-2">{plan.order}</dd></div>
                        <div><dt className="text-2xs uppercase tracking-wide text-fg-5">Then</dt><dd className="text-fg-2">{plan.then}</dd></div>
                        <div><dt className="text-2xs uppercase tracking-wide text-fg-5">If it fills anyway</dt><dd className="text-fg-2">{plan.ifFilled}</dd></div>
                    </dl>
                    {running && <Spinner label="Talking to the broker…" />}
                </div>
            )}
            {result && (
                <div className="space-y-2 text-xs">
                    <StatusBadge level={result.ok ? 'good' : 'critical'}>{result.ok ? 'drill passed' : 'drill failed'}</StatusBadge>
                    {result.error && <p className="text-danger">{result.error}</p>}
                    <ol className="space-y-1">
                        {(result.steps || []).map((s, i) => (
                            <li key={i} className="flex items-start gap-2">
                                <StatusBadge level={s.ok ? 'good' : 'critical'}>{s.ok ? 'ok' : 'failed'}</StatusBadge>
                                <span className="text-fg-2">{s.step}</span>
                                <span className="text-fg-5">{s.detail || s.error || ''}{s.ms != null ? ` · ${s.ms} ms` : ''}</span>
                            </li>
                        ))}
                    </ol>
                    {result.filledUnexpectedly && <p className="text-danger font-semibold">The order FILLED and was flattened at market — check the broker book.</p>}
                    {result.mcxQtyUnits && <p className="text-fg-4">MCX quantity was sent in {result.mcxQtyUnits} and accepted.</p>}
                </div>
            )}
        </Modal>
    );
}

function VenueCard({ v, plans, lastDrill, drillRunning, onDrill }) {
    const venueGates = v.gates.filter((g) => g.group !== 'drill');
    const drillGates = v.gates.filter((g) => g.group === 'drill');
    return (
        <Card docs="go-live#drills" title={VENUE_NAME[v.venue] || v.venue}
            subtitle={`${v.raw.env || 'production'}${v.raw.availableInr != null ? ` · ${inr(v.raw.availableInr)} available` : ''}`}
            right={<ReadinessLine summary={v.summary} />}>
            <GateList gates={venueGates} />
            <h3 className="text-2xs uppercase tracking-wide text-fg-5 mt-4 mb-1">Broker drills <DocLink to="go-live#drills" /></h3>
            <ul className="space-y-1.5">
                {SEGMENTS_OF[v.venue].map((seg) => {
                    const g = drillGates.find((x) => x.id === `drill.${seg}`);
                    const d = lastDrill[seg];
                    const plan = plans.find((p) => p.segment === seg);
                    return (
                        <li key={seg} className="flex flex-wrap items-center justify-between gap-2 border border-line/50 rounded px-2.5 py-1.5">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <StatusBadge level={g && g.status === 'pass' ? 'good' : d && !d.ok ? 'critical' : 'warning'}>
                                        {g && g.status === 'pass' ? 'proven' : d && !d.ok ? 'failed' : 'not proven'}
                                    </StatusBadge>
                                    <span className="text-xs text-fg-2">{SEGMENT_NAME[seg]}</span>
                                </div>
                                <div className="text-2xs text-fg-5 mt-0.5">{g ? g.have : 'never run'}</div>
                            </div>
                            <button type="button" disabled={!plan || !!drillRunning} onClick={() => onDrill(plan)}
                                className="px-2.5 py-1 rounded text-2xs font-semibold border border-primary/40 bg-primary/15 text-primary-ink disabled:opacity-40">
                                {drillRunning === seg ? 'Running…' : 'Run drill'}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}

function evidenceText(r) {
    const bt = r.gates.find((g) => g.id === 'evidence.backtest');
    return bt ? bt.have : '—';
}

function CanaryLine({ c }) {
    if (!c) return null;
    const level = c.state === 'PASSED' ? 'good' : c.state === 'DEMOTED' ? 'critical' : c.state === 'DEMOTE_PENDING' ? 'warning' : 'info';
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-2xs text-fg-4">
            <StatusBadge level={level}>canary {String(c.state).toLowerCase().replace('_', ' ')}</StatusBadge>
            <span>{c.liveTrades || 0}/{c.trades} live trades · net {inr(c.livePnl || 0, { sign: true })} (cap {inr(-Math.abs(c.lossCapInr))}) · {c.lots} lot(s)</span>
            {c.reason && <span className="text-fg-5">— {c.reason}</span>}
        </span>
    );
}

function DeploymentRow({ r, job, onGates, onVerify, onPromote, onDemote }) {
    const live = r.mode === 'LIVE';
    const p = r.paper || {};
    const running = job && job.state === 'running';
    return (
        <li className="border border-line/60 rounded-lg px-3 py-2.5 bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-fg truncate" title={r.name}>{r.name}</span>
                        <ModeChip mode={r.mode} />
                        <Chip tone="muted">{r.kind === 'multileg' ? 'multi-leg' : 'single-leg'}</Chip>
                        {r.isActive === false && <Chip tone="muted" title="Stopped — it takes no new entries">stopped</Chip>}
                    </div>
                    <div className="text-2xs text-fg-5 mt-0.5">{r.symbol}{r.strategy ? ` · ${r.strategy}` : ''}{r.segment ? ` · ${r.segment}` : ''}</div>
                </div>
                <ReadinessLine summary={r.summary} />
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-2 text-2xs">
                <div><dt className="inline text-fg-5">Paper: </dt><dd className="inline text-fg-3">{p.n ? `${p.n} trades over ${p.days} days · ${inr(p.mean, { sign: true })}/trade${p.t != null ? ` · t ${p.t.toFixed(2)}` : ''}` : 'no closed trades'}{p.skippedNoPnl ? ` (${p.skippedNoPnl} without P&L not counted)` : ''}</dd></div>
                <div><dt className="inline text-fg-5">Backtest: </dt><dd className="inline text-fg-3">{evidenceText(r)}</dd></div>
            </dl>
            {r.canary && <div className="mt-1.5"><CanaryLine c={r.canary} /></div>}
            {job && job.state !== 'none' && (
                <div className="mt-1.5 text-2xs">
                    {running && <Spinner label={`Backtesting ${job.window ? `${job.window.start} → ${job.window.end}` : ''}…`} />}
                    {job.state === 'error' && <span className="text-danger">Backtest failed: {job.error}</span>}
                    {job.state === 'refused' && <span className="text-warning">{job.error}</span>}
                    {job.state === 'done' && job.result && !job.stored && (
                        <span className="text-fg-3">Backtest done: in-sample {job.result.ins.n} trades {inr(job.result.ins.net, { sign: true })}, held-out {job.result.oos.n} trades {inr(job.result.oos.net, { sign: true })}
                            {job.result.excluded && (job.result.excluded.undated || job.result.excluded.noPnl) ? ` · ${job.result.excluded.undated + job.result.excluded.noPnl} trade(s) not countable` : ''}</span>
                    )}
                </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
                <button type="button" onClick={() => onGates(r)} className="px-2.5 py-1 rounded text-2xs border border-line text-fg-3">All gates</button>
                {r.kind === 'single' && (
                    <button type="button" onClick={() => onVerify(r)} disabled={running} className="px-2.5 py-1 rounded text-2xs border border-line text-fg-3 inline-flex items-center gap-1 disabled:opacity-40">
                        <FlaskConical className="w-3 h-3" aria-hidden="true" /> Verify backtest
                    </button>
                )}
                {!live && (
                    <button type="button" onClick={() => onPromote(r)} className="px-2.5 py-1 rounded text-2xs font-semibold bg-primary text-on-primary">
                        Promote to LIVE…
                    </button>
                )}
                {live && (
                    <button type="button" onClick={() => onDemote(r)} className="px-2.5 py-1 rounded text-2xs font-semibold border border-danger/40 bg-danger/10 text-danger">
                        Demote to PAPER
                    </button>
                )}
            </div>
        </li>
    );
}

export default function GoLive() {
    const confirm = useConfirm();
    const [status, setStatus] = useState({ data: null, error: null });
    const [deps, setDeps] = useState({ data: null, error: null, loading: true });
    const [drills, setDrills] = useState([]);
    const [drillAsk, setDrillAsk] = useState(null);
    const [drillRun, setDrillRun] = useState({ running: false, result: null });
    const [promote, setPromote] = useState(null);
    const [gatesOf, setGatesOf] = useState(null);
    const [jobs, setJobs] = useState({});
    const [filter, setFilter] = useState('paper');
    const pollers = useRef({});

    const loadStatus = useCallback(() => axios.get(`${GOLIVE}/status`)
        .then((r) => setStatus({ data: r.data, error: null }))
        .catch((e) => setStatus((s) => ({ ...s, error: errText(e) }))), []);
    const loadDeps = useCallback(() => {
        setDeps((d) => ({ ...d, loading: true }));
        return axios.get(`${GOLIVE}/deployments`, { timeout: 120000 })
            .then((r) => setDeps({ data: r.data, error: null, loading: false }))
            .catch((e) => setDeps((d) => ({ ...d, error: errText(e), loading: false })));
    }, []);
    const loadDrills = useCallback(() => axios.get(`${GOLIVE}/drills`).then((r) => setDrills(r.data.drills || [])).catch(() => {}), []);

    useEffect(() => {
        loadStatus(); loadDeps(); loadDrills();
        const t = setInterval(loadStatus, 30000);
        const timers = pollers.current;
        return () => { clearInterval(t); Object.values(timers).forEach(clearInterval); };
    }, [loadStatus, loadDeps, loadDrills]);

    const runDrill = async () => {
        setDrillRun({ running: true, result: null });
        try {
            const r = await axios.post(`${GOLIVE}/drill`, { segment: drillAsk.segment, confirm: true }, { timeout: 120000 });
            setDrillRun({ running: false, result: r.data });
        } catch (e) {
            setDrillRun({ running: false, result: { ok: false, error: errText(e), steps: [] } });
        }
        loadStatus(); loadDrills(); loadDeps();
    };

    const pollJob = (id) => {
        clearInterval(pollers.current[id]);
        pollers.current[id] = setInterval(async () => {
            try {
                const r = await axios.get(`${GOLIVE}/deployments/single/${id}/verify-backtest`);
                setJobs((j) => ({ ...j, [id]: r.data }));
                if (r.data.state !== 'running') {
                    clearInterval(pollers.current[id]);
                    delete pollers.current[id];
                    if (r.data.state === 'done') loadDeps();
                }
            } catch (_) { /* keep polling */ }
        }, 4000);
    };

    const verify = async (r) => {
        try {
            const res = await axios.post(`${GOLIVE}/deployments/single/${r.id}/verify-backtest`, {});
            setJobs((j) => ({ ...j, [r.id]: res.data }));
            if (res.data.state === 'running') pollJob(r.id);
        } catch (e) {
            setJobs((j) => ({ ...j, [r.id]: e?.response?.data || { state: 'error', error: errText(e) } }));
        }
    };

    const demote = async (r) => {
        const ok = await confirm({
            title: `Demote ${r.name} to PAPER?`,
            body: r.kind === 'multileg'
                ? 'New entries become simulated. A structure with legs at the broker must be closed first.'
                : 'New entries become simulated. An open live position stays live and exits at the broker.',
            confirmLabel: 'Demote to PAPER',
        });
        if (!ok) return;
        try {
            const res = await axios.post(`${GOLIVE}/deployments/${r.kind}/${r.id}/demote`, { reason: 'manual (Go-Live page)' });
            toast.success(`${r.name} is PAPER`);
            if (res.data.note) toast.info(res.data.note);
            loadDeps();
        } catch (e) { toast.error(errText(e)); }
    };

    const reports = useMemo(() => (deps.data ? deps.data.reports : []), [deps.data]);
    const counts = useMemo(() => ({
        all: reports.length,
        paper: reports.filter((r) => r.mode !== 'LIVE').length,
        live: reports.filter((r) => r.mode === 'LIVE').length,
        ready: reports.filter((r) => r.mode !== 'LIVE' && r.summary.ready).length,
    }), [reports]);
    const shown = useMemo(() => reports
        .filter((r) => (filter === 'all' ? true : filter === 'live' ? r.mode === 'LIVE' : filter === 'ready' ? r.mode !== 'LIVE' && r.summary.ready : r.mode !== 'LIVE'))
        .sort((a, b) => (a.summary.counts.hard - b.summary.counts.hard) || (a.summary.counts.soft - b.summary.counts.soft) || String(a.name).localeCompare(String(b.name))),
    [reports, filter]);

    const s = status.data;
    const venuesBlocked = s ? s.venues.filter((v) => v.summary.hard.length).map((v) => VENUE_NAME[v.venue]) : [];
    const readyNow = counts.ready;
    const verdict = !s ? null
        : readyNow > 0 && !venuesBlocked.length ? { level: 'good', text: `${readyNow} deployment${readyNow === 1 ? '' : 's'} can be promoted` }
        : { level: 'critical', text: 'Not ready for real money' };

    return (
        <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
            <PageHeader foldAll docs="go-live#overview" icon={Rocket} title="Go Live"
                subtitle="PAPER → LIVE goes through here and nowhere else: prove the broker accepts your orders, show the strategy makes money, then promote with a canary that demotes itself on losses."
                badges={verdict && <StatusBadge level={verdict.level}>{verdict.text}</StatusBadge>}
                actions={(
                    <button type="button" onClick={() => { loadStatus(); loadDeps(); loadDrills(); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3">
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Re-check
                    </button>
                )} />

            {status.error && <p className="text-xs text-danger" role="alert">Status: {status.error}</p>}
            {!s ? <SkeletonTiles count={4} /> : (
                <StatRow cols={4}>
                    <StatTile label={<>Real trades ever <DocLink to="go-live#summary" /></>} value={s.liveTradesEver == null ? '—' : s.liveTradesEver}
                        hint={`${s.liveTradesEver === 0 ? 'every fill so far was simulated' : 'closed trades with a broker order id'}${s.liveTradesBreakdown && s.liveTradesBreakdown.markedLiveWithoutBrokerId ? ` · ${s.liveTradesBreakdown.markedLiveWithoutBrokerId} older rows marked live have no broker order id (not counted)` : ''}`}
                        tone={s.liveTradesEver === 0 ? 'negative' : 'neutral'} />
                    <StatTile label="Venues blocking" value={venuesBlocked.length} hint={venuesBlocked.length ? venuesBlocked.join(', ') : 'both venues clear'} tone={venuesBlocked.length ? 'negative' : 'positive'} />
                    <StatTile label="Ready to promote" value={deps.data ? readyNow : '—'} hint={deps.data ? `of ${counts.paper} on paper` : 'checking…'} />
                    <StatTile label="Live now" value={deps.data ? counts.live : '—'} hint={s.engine.halted ? `engine halted: ${s.engine.haltReason || ''}` : s.engine.running ? 'engine running' : 'engine stopped'}
                        tone={s.engine.halted ? 'negative' : 'neutral'} />
                </StatRow>
            )}

            <section aria-label="Venues" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {s && s.venues.map((v) => (
                    <VenueCard key={v.venue} v={v} plans={s.drillPlans || []} lastDrill={v.raw.lastDrill || {}}
                        drillRunning={s.drillRunning || (drillRun.running ? drillAsk?.segment : null)}
                        onDrill={(plan) => { setDrillRun({ running: false, result: null }); setDrillAsk(plan); }} />
                ))}
            </section>

            <Card docs="go-live#deployments" title="Deployments" subtitle="Every single-leg and multi-leg deployment, checked against every gate. Promotion asks for the canary settings and, if the evidence is missing, a recorded override."
                right={<Segmented value={filter} onChange={setFilter} options={[
                    { v: 'paper', label: `Paper (${counts.paper})` },
                    { v: 'ready', label: `Ready (${counts.ready})` },
                    { v: 'live', label: `Live (${counts.live})` },
                    { v: 'all', label: `All (${counts.all})` },
                ]} />}>
                {deps.error && <p className="text-xs text-danger" role="alert">{deps.error}</p>}
                {deps.loading && !deps.data && <Spinner label="Checking every deployment (broker, evidence, risk)…" />}
                {deps.data && deps.data.failed && deps.data.failed.length > 0 && (
                    <div className="text-2xs text-warning mb-2" role="status">
                        {deps.data.failed.length} deployment(s) could not be checked: {deps.data.failed.map((f) => `${f.name} (${f.error})`).join('; ')}
                    </div>
                )}
                {deps.data && !shown.length && (
                    <EmptyState icon={ShieldAlert} title="Nothing here">
                        {filter === 'ready' ? 'No paper deployment passes every gate yet — open one to see what is missing.' : 'No deployments in this view.'}
                    </EmptyState>
                )}
                <ul className="space-y-2">
                    {shown.map((r) => (
                        <DeploymentRow key={`${r.kind}:${r.id}`} r={r} job={jobs[r.id]}
                            onGates={setGatesOf} onVerify={verify}
                            onPromote={(x) => setPromote({ kind: x.kind, id: x.id, name: x.name })}
                            onDemote={demote} />
                    ))}
                </ul>
            </Card>

            <Card docs="go-live#drills" title="Drill history" subtitle="Every broker drill, newest first.">
                <DataTable dense empty="No drill has been run." rows={drills.map((d) => ({ ...d, _key: String(d._id) }))} columns={[
                    { key: 'at', header: 'When', render: (d) => when(d.at) },
                    { key: 'segment', header: 'Segment', render: (d) => SEGMENT_NAME[d.segment] || d.segment },
                    { key: 'instrument', header: 'Instrument' },
                    { key: 'mode', header: 'Order' },
                    { key: 'ok', header: 'Result', render: (d) => <StatusBadge level={d.ok ? 'good' : 'critical'}>{d.ok ? 'passed' : 'failed'}</StatusBadge> },
                    { key: 'error', header: 'Detail', render: (d) => <span className="text-fg-4">{d.error || `${(d.steps || []).length} steps · ${d.ms ?? '—'} ms`}</span> },
                ]} />
            </Card>

            <DrillDialog plan={drillAsk} running={drillRun.running} result={drillRun.result} onRun={runDrill}
                onClose={() => { setDrillAsk(null); setDrillRun({ running: false, result: null }); }} />

            <Modal docs="go-live#deployments" open={!!gatesOf} onClose={() => setGatesOf(null)} title={gatesOf ? `Gates — ${gatesOf.name}` : ''} width="max-w-2xl">
                {gatesOf && <GateList gates={gatesOf.gates} />}
            </Modal>

            <PromoteDialog open={!!promote} kind={promote?.kind} id={promote?.id} name={promote?.name}
                onClose={() => setPromote(null)}
                onDone={(res) => { setPromote(null); toast.success(`LIVE — canary: ${res.canary.trades} trades at ${res.canary.lots} lot(s)`); loadDeps(); loadStatus(); }} />
        </div>
    );
}
