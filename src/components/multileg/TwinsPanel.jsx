/**
 * TwinsPanel — each LIVE deployment next to its PAPER twin, day by day (user, 27-Oct-2026: "make
 * nifty-wide-tail (LIVE) in PAPER mode also to see the difference between both, like
 * nifty-atm-straddle"). Same structure and settings; what separates the books is what real trading
 * adds — fill prices, a rejected or refused entry, a stop filled at the broker. The LIVE events
 * that explain a day's difference are listed on that day.
 * Data: GET /api/multileg/twins (backend logic/multileg/twins.js), passed in by the page.
 */
import React from 'react';
import { GitCompare } from 'lucide-react';
import { Panel } from '../viz/primitives';
import { istDayLabel, pnlTone } from '../viz/tokens';
import { signedRs } from './liveCapitalFormat.js';

export default function TwinsPanel({ data }) {
    const pairs = (data && Array.isArray(data.pairs) ? data.pairs : []).filter((p) => p && p.live && p.paper && p.total && Array.isArray(p.days));
    return (
        <Panel className="mb-4" icon={GitCompare} iconClassName="text-sky-400" title={`LIVE vs PAPER twins (${pairs.length})`}
            storageKey="fold:multi-leg|twins" docs="multi-leg#deploy-twins"
            summary={pairs.length ? pairs.map((p) => `${p.base}: LIVE ${signedRs(p.total.live)} · PAPER ${signedRs(p.total.paper)}`).join(' · ') : 'No pair yet: press Paper twin on a LIVE card'}>
            {pairs.length === 0 ? (
                <p className="text-xs text-fg-5">No LIVE deployment has a PAPER twin yet. <b>Paper twin</b> on a LIVE card makes one: the same structure, settings and lots, with simulated fills.</p>
            ) : (
                <div className="space-y-4" data-testid="twins">
                    {pairs.map((p) => (
                        <div key={p.live.id}>
                            <div className="text-xs text-fg-2 font-semibold">{p.base} <span className="font-normal text-fg-5">· {p.symbol.replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')} · since {istDayLabel(p.sinceDay, { year: false })}{p.linkedBy === 'name' ? ' · paired by name' : ''}</span></div>
                            <div className="text-2xs text-fg-4">
                                LIVE <b className={pnlTone(p.total.live)}>{signedRs(p.total.live)}</b> ({p.total.liveTrades} trades) · PAPER <b className={pnlTone(p.total.paper)}>{signedRs(p.total.paper)}</b> ({p.total.paperTrades}) · difference <b className={pnlTone(p.total.diff)}>{signedRs(p.total.diff)}</b>
                                {p.live.openNet != null || p.paper.openNet != null ? ` · open now: LIVE ${signedRs(p.live.openNet)} / PAPER ${signedRs(p.paper.openNet)}` : ''}
                            </div>
                            {p.lotsDiffer && <div className="text-2xs text-warning">Their lots differ ({p.live.name}: {p.live.lots}, {p.paper.name}: {p.paper.lots}): the ₹ are not like for like.</div>}
                            {p.days.length > 0 && (
                                <div className="overflow-x-auto mt-1">
                                    <table className="w-full text-2xs">
                                        <thead><tr className="text-fg-5 text-left">
                                            <th className="font-normal py-0.5">Day</th><th className="font-normal text-right">LIVE</th><th className="font-normal text-right">PAPER</th>
                                            <th className="font-normal text-right">LIVE − PAPER</th><th className="font-normal pl-2">Why they differ (LIVE)</th>
                                        </tr></thead>
                                        <tbody>
                                            {p.days.map((d) => (
                                                <tr key={d.day} className="border-t border-line-0 align-top">
                                                    <td className="py-0.5 text-fg-4">{istDayLabel(d.day, { year: false })}</td>
                                                    <td className={`text-right ${d.live.n ? pnlTone(d.live.net) : 'text-fg-5'}`} title={d.live.reasons.join(', ')}>{d.live.n ? signedRs(d.live.net) : 'no trade'}</td>
                                                    <td className={`text-right ${d.paper.n ? pnlTone(d.paper.net) : 'text-fg-5'}`} title={d.paper.reasons.join(', ')}>{d.paper.n ? signedRs(d.paper.net) : 'no trade'}</td>
                                                    <td className={`text-right ${pnlTone(d.diff)}`}>{signedRs(d.diff)}</td>
                                                    {/* the server compares the two days' trades (twins.explainDay) — nothing is assumed here */}
                                                    <td className="pl-2 text-fg-5">{d.why.map((w, i) => <div key={i}>{w}</div>)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ))}
                    <p className="text-3xs text-fg-5">Both books run the same rules; PAPER fills at the quote with no account behind it, LIVE at the broker. Days are when each trade was entered.</p>
                </div>
            )}
        </Panel>
    );
}
