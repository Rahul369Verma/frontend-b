import React from 'react';
import { DataTable, StatRow, StatTile, Chip } from './primitives';
import { inr, pnlTone, monthYear } from './tokens';

/**
 * Backtest P&L split by India VIX band — "which days are good for this strategy?".
 *
 * VIX here is the PREVIOUS session's close: known before 09:15, one value per
 * day, never the day's own close (that would be filtering on the future).
 *
 * Deliberately does NOT crown a "best band". Picking the top row of this table
 * and then filtering on it is in-sample selection; bands are fixed (not
 * quantiles) so a choice made on one period can be CHECKED on another.
 */
const dash = <span className="text-fg-5">—</span>;

export default function VixBreakdownPanel({ data }) {
    if (!data) return null;
    const { breakdown, gate, source, sessions, simIv, nullTest } = data;
    const bands = breakdown?.bands || [];
    const byBand = sessions?.byBand || {};
    const detail = sessions?.detail || {};

    const rows = bands.map((b) => ({
        _key: b.band,
        band: b.band,
        sessions: byBand[b.band] ?? null,
        seen: detail[b.band] || null,
        ...b,
    }));
    const singleEpisode = rows.filter((r) => r.seen && r.seen.episodes === 1 && r.trades > 0).map((r) => r.band);

    const columns = [
        { key: 'band', header: 'VIX (prev close)', render: (r) => <span className="font-medium">{r.band}</span> },
        { key: 'sessions', header: 'Sessions', align: 'right', render: (r) => (r.sessions == null ? dash : r.sessions) },
        { key: 'seen', header: 'When', render: (r) => {
            const s = r.seen;
            if (!s || !s.sessions) return dash;
            const span = monthYear(s.firstDay) === monthYear(s.lastDay) ? monthYear(s.firstDay) : `${monthYear(s.firstDay)} – ${monthYear(s.lastDay)}`;
            return (
                <span className={s.episodes === 1 ? 'text-warning' : ''}
                      title={s.episodes === 1 ? 'Only one episode: this band cannot be separated from what that period was like.' : undefined}>
                    {span} · {s.episodes} episode{s.episodes === 1 ? '' : 's'}
                </span>
            );
        } },
        { key: 'days', header: 'Days traded', align: 'right', render: (r) => (r.days ? r.days : dash) },
        { key: 'trades', header: 'Trades', align: 'right', render: (r) => (r.trades ? r.trades : dash) },
        { key: 'winRatePct', header: 'Win %', align: 'right', render: (r) => (r.winRatePct == null ? dash : `${r.winRatePct}%`) },
        { key: 'netPnl', header: 'Net P&L', align: 'right',
          render: (r) => (r.trades ? <span className={pnlTone(r.netPnl)}>{inr(r.netPnl, { sign: true })}</span> : dash) },
        { key: 'avgPnlPerDay', header: 'Avg / day', align: 'right',
          render: (r) => (r.avgPnlPerDay == null ? dash : <span className={pnlTone(r.avgPnlPerDay)}>{inr(r.avgPnlPerDay, { sign: true })}</span>) },
        { key: 'avgPnlPerTrade', header: 'Avg / trade', align: 'right',
          render: (r) => (r.avgPnlPerTrade == null ? dash : <span className={pnlTone(r.avgPnlPerTrade)}>{inr(r.avgPnlPerTrade, { sign: true })}</span>) },
    ];

    const gateOn = gate && gate.evaluated > 0;
    const codes = gate?.byCode || {};
    const ex = breakdown?.excluded || {};
    const srcLabel = source?.daily === 'fyers' ? 'Fyers' : source?.daily === 'archive' ? 'local archive' : 'unavailable';

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-5">
                <Chip tone={source?.daily === 'fyers' ? 'good' : source?.daily === 'archive' ? 'warning' : 'critical'}>
                    VIX source: {srcLabel}
                </Chip>
                {simIv && simIv.model && (
                    <Chip tone={simIv.model === 'vix' ? 'good' : 'warning'}>
                        premiums priced at: {simIv.model === 'vix' ? 'India VIX at entry' : 'fixed 15% IV'}
                    </Chip>
                )}
                {sessions && <span>{sessions.total} sessions in range{sessions.unmeasured ? ` · ${sessions.unmeasured} without a VIX value` : ''}</span>}
            </div>

            {simIv && simIv.model === 'fixed' && (simIv.fixed > 0) && (
                <p className="text-xs text-warning">
                    ⚠ Option premiums were simulated at a flat 15% IV on every day. That prices high-VIX days too cheap and
                    low-VIX days too dear, which flatters option buyers on exactly the high-VIX days — this table is biased
                    toward them. Re-run with <code>sim_iv_source = vix</code> for a fair comparison across bands.
                </p>
            )}

            {gateOn && (
                <StatRow cols={4}>
                    <StatTile label="Signals checked" value={gate.evaluated} hint="entries the VIX filter saw" />
                    <StatTile label="Blocked" value={gate.blocked} tone={gate.blocked ? 'negative' : 'neutral'}
                        hint={`below min ${codes.BELOW_MIN || 0} · above max ${codes.ABOVE_MAX || 0}`} />
                    <StatTile label="Allowed in band" value={codes.IN_BAND || 0} tone="positive" />
                    <StatTile label="Unmeasured" value={codes.UNMEASURED || 0}
                        hint="no VIX known — passed, not filtered" />
                </StatRow>
            )}

            <DataTable columns={columns} rows={rows} dense empty="No trades carried a VIX value" />

            {/* The statistical verdict on the whole table. Without it, the eye picks
                the top row; with it, the table says whether that row means anything. */}
            {nullTest && nullTest.pRotation != null && (
                <p className={`text-xs ${nullTest.pRotation < 0.05 ? 'text-warning' : 'text-fg-4'}`}
                   title="Regime-rotation null: the VIX sequence is slid against the P&L sequence, keeping each one's clustering, so only their alignment is randomised. A shuffle test (which breaks the clustering and overstates significance) is shown for comparison.">
                    {nullTest.pRotation < 0.05
                        ? <>⚑ Band differences look larger than chance (p = {nullTest.pRotation.toFixed(3)}). Confirm on a later period before filtering on a band.</>
                        : <>Band differences are <strong>not distinguishable from chance</strong> (p = {nullTest.pRotation.toFixed(2)}) — a VIX filter is unlikely to help this strategy.</>}
                    <span className="text-fg-5"> · shuffle p = {nullTest.pShuffle.toFixed(2)} · {nullTest.units} sessions</span>
                </p>
            )}
            {nullTest && nullTest.pRotation == null && nullTest.verdict && (
                <p className="text-xs text-fg-5">Significance: {nullTest.verdict}.</p>
            )}

            {(ex.noVix > 0 || ex.noPnl > 0) && (
                <p className="text-xs text-fg-5">
                    Not in any band: {ex.noVix > 0 && <>{ex.noVix} trade{ex.noVix === 1 ? '' : 's'} with no VIX value ({inr(ex.noVixPnl, { sign: true })})</>}
                    {ex.noVix > 0 && ex.noPnl > 0 && ' · '}
                    {ex.noPnl > 0 && <>{ex.noPnl} without a P&amp;L figure</>}.
                </p>
            )}
            {breakdown?.caution && (
                <p className="text-xs text-warning">⚠ {breakdown.caution}.</p>
            )}
            {singleEpisode.length > 0 && (
                <p className="text-xs text-warning">
                    ⚠ {singleEpisode.join(', ')} occurred in a single stretch of time, so its row reflects that period as much as
                    the VIX level. Judge a band only once it has shown up in more than one separate episode.
                </p>
            )}
            <p className="text-2xs text-fg-5 leading-relaxed">
                VIX is the previous session&rsquo;s close, known before the open — never the day&rsquo;s own close.
                Choosing a band from this table and filtering on it is fitting to the past: pick it on one period,
                then confirm it on a later one before trusting it. Bands are fixed so runs can be compared.
            </p>
        </div>
    );
}
