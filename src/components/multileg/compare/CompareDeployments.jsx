/**
 * Multi-Leg → Compare: deployed strategies side by side — who they are, their results row by
 * row (best and worst marked), the settings the engine runs for each (differences first), their
 * curves overlaid, where the money came from, and how they behave as one book.
 *
 * Data: GET /api/multileg/compare/options (the picker, from the database, so it works with the
 * engines off) and GET /api/multileg/compare?ids=…&days=… (the Results tab's own scorecard rows
 * plus the shapes below; backend logic/analytics/multilegCompare.js).
 *
 * The selection lives in the URL (?cmp=id,id) so a comparison can be shared or bookmarked, and
 * in this browser so it survives a refresh. Each deployment keeps one colour everywhere.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { GitCompareArrows, RefreshCw, Download, BarChart3, SlidersHorizontal, LineChart as LineIcon, Grid3x3, Users, AlertTriangle } from 'lucide-react';
import { API_URL } from '../../../config/api.js';
import { Card, Panel, Segmented, Spinner, EmptyState, SkeletonTiles } from '../../viz/primitives';
import { useChartTheme } from '../../../theme/chartTheme.js';
import useLocalStorage from '../../../hooks/useLocalStorage.js';
import { rowsToCsv, saveBlob } from '../../charts/chartFrameMath.js';
import ComparePicker, { MAX_COMPARE } from './ComparePicker.jsx';
import { IdentityCards, MetricsTable, ConfigTable, ChartsPanel, BreakdownGrid, TogetherPanel } from './CompareSections.jsx';
import { scoreboard, seriesColors, csvRowsOf, diversificationLine } from './compareFormat.js';
import { istDateTime } from '../../viz/tokens.js';

const WINDOWS = [
    { v: '30', label: '30 days', hint: 'Trades that closed in the last 30 days' },
    { v: '90', label: '90 days', hint: 'Trades that closed in the last 90 days' },
    { v: 'all', label: 'All time', hint: 'Every trade each deployment closed' },
];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const parseIds = (s) => [...new Set(String(s || '').split(',').map((x) => x.trim()).filter((x) => ID.test(x)))].slice(0, MAX_COMPARE);
const errText = (e) => e?.response?.data?.error || e?.response?.data?.message || e?.message || 'request failed';

export default function CompareDeployments() {
    const ct = useChartTheme();
    const [sp, setSp] = useSearchParams();
    const [storedIds, setStoredIds] = useLocalStorage('ml.compare.ids', [], { validate: Array.isArray });
    const [win, setWin] = useLocalStorage('ml.compare.window', 'all', { validate: (v) => WINDOWS.some((w) => w.v === v) });
    const urlIds = parseIds(sp.get('cmp'));
    const ids = urlIds.length ? urlIds : parseIds((storedIds || []).join(','));
    const idsKey = ids.join(',');

    const setIds = useCallback((next) => {
        const clean = parseIds(next.join(','));
        setStoredIds(clean);
        setSp((p) => { const q = new URLSearchParams(p); if (clean.length) q.set('cmp', clean.join(',')); else q.delete('cmp'); return q; }, { replace: true });
    }, [setSp, setStoredIds]);

    const params = useMemo(() => (win === 'all' ? {} : { days: Number(win) }), [win]);

    // Each fetch stamps its answer with the request key it answered; "loading" is simply "the last
    // answer is for another key". A superseded request is dropped by the effect's cleanup, so a
    // slow answer never paints over a newer pick.
    // ── the picker's list ──
    const [optNonce, setOptNonce] = useState(0);
    const optKey = `${win}|${optNonce}`;
    const [options, setOptions] = useState({ key: null, list: [], error: null });
    useEffect(() => {
        let alive = true;
        axios.get(`${API_URL}/multileg/compare/options`, { params })
            .then((r) => { if (alive) setOptions({ key: optKey, list: Array.isArray(r.data?.deployments) ? r.data.deployments : [], error: null }); })
            .catch((e) => { if (alive) setOptions((o) => ({ ...o, key: optKey, error: errText(e) })); });
        return () => { alive = false; };
    }, [params, optKey]);
    const optionsLoading = options.key !== optKey;
    const loadOptions = () => setOptNonce((n) => n + 1);

    // ── the comparison ──
    const [nonce, setNonce] = useState(0);
    const reqKey = `${idsKey}|${win}|${nonce}`;
    const [cmp, setCmp] = useState({ key: null, data: null, error: null, at: null });
    useEffect(() => {
        if (!idsKey) return undefined;
        let alive = true;
        axios.get(`${API_URL}/multileg/compare`, { params: { ...params, ids: idsKey } })
            .then((r) => { if (alive) setCmp({ key: reqKey, data: r.data, error: null, at: new Date() }); })
            .catch((e) => { if (alive) setCmp((c) => ({ ...c, key: reqKey, error: errText(e) })); });
        return () => { alive = false; };
    }, [idsKey, params, reqKey]);
    const cmpLoading = !!idsKey && cmp.key !== reqKey;
    const cmpError = cmpLoading ? null : cmp.error;
    const loadCompare = () => setNonce((n) => n + 1);

    // ── one colour per chosen slot, kept by every section ──
    const slotColors = useMemo(() => seriesColors(ct, Math.max(ids.length, 1)), [ct, ids.length]);
    const colorOf = useMemo(() => new Map(ids.map((id, i) => [id, slotColors[i]])), [ids, slotColors]);
    const data = idsKey && cmp.data && cmp.data.deployments ? cmp.data : null;
    // in the order chosen; a row with no deployment and no trades is listed in the notice instead
    const deps = useMemo(() => (data ? data.deployments.filter((d) => idsKey.split(',').includes(d.id) && (d.found || (d.results?.trades ?? 0) > 0 || (d.daily || []).length > 0)) : []), [data, idsKey]);
    const colors = deps.map((d) => colorOf.get(d.id) || ct.categorical[0]);
    const missing = useMemo(() => {
        if (!data) return [];
        const shown = new Set(deps.map((d) => d.id));
        return ids.filter((id) => !shown.has(id));
    }, [data, deps, ids]);
    const nameOf = (id) => options.list.find((o) => o.id === id)?.name || id;
    const { wins, ranked } = useMemo(() => scoreboard(deps), [deps]);

    const downloadCsv = () => {
        const rows = csvRowsOf(deps, data?.groups || []);
        saveBlob(new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' }), `multileg-compare-${new Date().toISOString().slice(0, 10)}.csv`);
    };
    const remove = (id) => setIds(ids.filter((x) => x !== id));
    const summary = deps.length ? `${deps.length} deployment${deps.length === 1 ? '' : 's'} · ${WINDOWS.find((w) => w.v === win)?.label.toLowerCase()}` : null;

    return (
        <div className="space-y-4" data-testid="compare-tab">
            <Panel title="Compare deployments" icon={GitCompareArrows} docs="multi-leg#compare-tab" collapsible={false}
                subtitle="Pick up to six deployed strategies — running, stopped or deleted with trades — and see them side by side."
                right={(
                    <div className="flex flex-wrap items-center gap-2">
                        <Segmented options={WINDOWS} value={win} onChange={setWin} />
                        <button type="button" onClick={() => { loadOptions(); loadCompare(); }} disabled={cmpLoading || optionsLoading}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-50" title="Fetch again">
                            <RefreshCw className={`w-3 h-3 ${cmpLoading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh
                        </button>
                        <button type="button" onClick={downloadCsv} disabled={!deps.length}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40" title="Results and settings of the chosen deployments as CSV">
                            <Download className="w-3 h-3" aria-hidden="true" />CSV
                        </button>
                    </div>
                )}>
                {options.error ? (
                    <p className="text-xs text-danger" role="alert">Could not load the deployments to choose from: {options.error}. <button type="button" className="underline" onClick={loadOptions}>Try again</button></p>
                ) : optionsLoading && !options.list.length ? <Spinner label="Loading deployments…" /> : (
                    <ComparePicker options={options.list} selected={ids} colors={slotColors} onChange={setIds} />
                )}
                {!optionsLoading && !options.error && options.list.length === 0 && (
                    <p className="text-xs text-fg-5 mt-2">No multileg deployment exists yet, and none was deleted with trades. Deploy one from the Deploy tab first.</p>
                )}
                {cmp.at && <p className="text-4xs text-fg-5 mt-2">Fetched {istDateTime(cmp.at, { seconds: true })} IST. Numbers are after charges; quarantined trades are left out, as on the Results tab.</p>}
            </Panel>

            {!ids.length && (
                <EmptyState icon={GitCompareArrows} title="Nothing chosen yet">
                    Choose two or more deployments above, or use a quick pick. You will see their results row by row with the best and worst of each marked,
                    every setting the engine runs for them with the differences first, their equity, drawdown and daily P&amp;L on shared charts,
                    where their money came from, and whether they win and lose on the same days.
                </EmptyState>
            )}

            {cmpError && (
                <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger flex flex-wrap items-center gap-2" role="alert">
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />The comparison could not be loaded: {cmpError}.
                    <button type="button" className="underline" onClick={loadCompare}>Try again</button>
                    {data && <span className="text-fg-4">Showing the previous answer below.</span>}
                </div>
            )}

            {ids.length > 0 && !data && cmpLoading && <SkeletonTiles count={Math.min(ids.length, 4)} cols={Math.min(ids.length, 4)} />}

            {data && (
                <>
                    {(missing.length > 0 || data.truncated) && (
                        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning space-y-1" role="status">
                            {missing.length > 0 && (
                                <p>Not shown: {missing.map(nameOf).join(', ')} — {missing.length === 1 ? 'it no longer exists and has' : 'they no longer exist and have'} no trades in this window.
                                    {' '}<button type="button" className="underline" onClick={() => setIds(ids.filter((x) => !missing.includes(x)))}>Remove from the selection</button></p>
                            )}
                            {data.truncated && <p>Only the newest {data.truncated.kept.toLocaleString('en-IN')} trades are counted (from {data.truncated.since ? istDateTime(data.truncated.since) : '—'}). Pick a shorter window to cover all of it.</p>}
                        </div>
                    )}

                    {deps.length > 0 && (
                        <div className={cmpLoading ? 'opacity-60 transition-opacity' : ''} aria-busy={cmpLoading}>
                            <div className="space-y-4">
                                <IdentityCards deps={deps} colors={colors} wins={wins} ranked={ranked} onRemove={remove} asOf={cmp.at ? cmp.at.getTime() : null} />

                                <Card title="Results side by side" icon={BarChart3} docs="multi-leg#compare-tab" storageKey="fold:ml-compare|results" summary={summary}>
                                    <MetricsTable deps={deps} colors={colors} />
                                </Card>

                                <Card title="Equity, drawdown and daily P&L" icon={LineIcon} docs="multi-leg#compare-tab" storageKey="fold:ml-compare|charts" summary="Overlaid curves, one colour per deployment">
                                    <ChartsPanel data={data} deps={deps} colors={colors} />
                                </Card>

                                <Card title="Deployed settings" icon={SlidersHorizontal} docs="multi-leg#compare-tab" storageKey="fold:ml-compare|settings" summary="What the engine runs for each, differences first">
                                    <ConfigTable deps={deps} colors={colors} groups={data.groups || []} />
                                </Card>

                                <Card title="Where the money came from" icon={Grid3x3} docs="multi-leg#compare-tab" storageKey="fold:ml-compare|breakdowns" summary="By exit reason, entry hour and weekday">
                                    <BreakdownGrid deps={deps} colors={colors} />
                                </Card>

                                {deps.length > 1 && (
                                    <Card title="Together" icon={Users} docs="multi-leg#compare-tab" storageKey="fold:ml-compare|together"
                                        summary={diversificationLine(data.combined) || 'Correlation, head to head and the combined book'}>
                                        <TogetherPanel data={data} deps={deps} colors={colors} />
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}
                    {deps.length === 0 && missing.length === 0 && <p className="text-xs text-fg-5">Nothing to show for this selection.</p>}
                </>
            )}
        </div>
    );
}
