/**
 * StrategyJsonControls — the Backtester's "Copy JSON / Download / Import JSON".
 *
 * Export writes every current setting as one portable JSON (utils/strategyJson.js).
 * Import takes that JSON — or one copied from any Optimizer result — shows in
 * plain words what it is and exactly which settings it will change, and loads it
 * only when you press "Load into Backtest". Nothing runs by itself.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Copy, Download, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal, StatusBadge } from '../viz/primitives';
import { istDateTime } from '../viz/tokens.js';
import { toast } from '../toastStore.js';
import {
    buildStrategyJson, strategyJsonText, parseStrategyJson, diffSettings, copyText, downloadJson, jsonFileName,
} from '../../utils/strategyJson.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';
const show = (v) => (v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const shortSym = (s) => String(s || '').replace(/^(NSE|BSE|MCX):/, '').replace(/-INDEX$/, '');

function ResultsLine({ results }) {
    if (!results || typeof results !== 'object') return null;
    const parts = [];
    if (results.verdict) parts.push(results.verdict);
    if (results.testPnL != null) parts.push(`test P&L ₹${Math.round(results.testPnL).toLocaleString('en-IN')}`);
    if (results.testWinRate != null) parts.push(`test win ${Number(results.testWinRate).toFixed(1)}%`);
    if (results.testPF != null) parts.push(`test PF ${Number(results.testPF) >= 1e9 ? '∞' : Number(results.testPF).toFixed(2)}`);
    if (results.testTrades != null) parts.push(`${results.testTrades} test trades`);
    if (results.fullPnL != null) parts.push(`full window ₹${Math.round(results.fullPnL).toLocaleString('en-IN')}${results.fullTrades != null ? ` · ${results.fullTrades} trades` : ''}`);
    if (!parts.length) return null;
    return <p className="text-2xs text-fg-4">Where it came from: {parts.join(' · ')}</p>;
}

export function ImportDialog({ open, onClose, current, onImport, knownStrategies, buildNext = null }) {
    const [text, setText] = useState('');
    const [showChanges, setShowChanges] = useState(false);
    const fileRef = useRef(null);
    const parsed = useMemo(() => (text.trim() ? parseStrategyJson(text, { knownStrategies }) : null), [text, knownStrategies]);
    // buildNext: how the page applies it (Backtest rebuilds from its system settings, so the old
    // strategy's parameters are cleared) — the preview shows exactly that result
    const next = useMemo(() => (parsed && parsed.ok ? (buildNext ? buildNext(current, parsed.settings) : { ...current, ...parsed.settings }) : null), [parsed, current, buildNext]);
    const changes = useMemo(() => (next ? diffSettings(current, next, { removed: !!buildNext }) : []), [next, current, buildNext]);
    const cleared = changes.filter((c) => c.removed).length;

    const onFile = async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try { setText(await f.text()); } catch (err) { toast.error(`Could not read the file: ${err.message}`); }
        e.target.value = '';
    };
    const close = () => { setText(''); setShowChanges(false); onClose(); };
    const apply = () => {
        if (!parsed || !parsed.ok) return;
        onImport(next, parsed);
        toast.success(`Loaded ${parsed.settings.strategy}${parsed.settings.symbol ? ` on ${shortSym(parsed.settings.symbol)}` : ''} — ${changes.length} setting${changes.length === 1 ? '' : 's'} changed. Press Run to test it.`);
        close();
    };

    return (
        <Modal open={open} onClose={close} width="max-w-2xl" title="Import strategy JSON" docs="backtest#strategy-json"
            footer={(
                <>
                    <button type="button" className={BTN} onClick={close}>Cancel</button>
                    <button type="button" onClick={apply} disabled={!parsed || !parsed.ok}
                        className="px-3 py-1.5 rounded text-xs bg-primary text-on-primary hover:opacity-90 disabled:opacity-40">Load into Backtest</button>
                </>
            )}>
            <div className="space-y-3 text-xs text-fg-3">
                <p className="text-fg-4">Paste a strategy JSON — from <b>Copy JSON</b> here, or <b>Copy JSON</b> on any Optimizer result — or choose a saved .json file. Nothing changes until you press <b>Load into Backtest</b>.</p>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false} aria-label="Strategy JSON"
                    placeholder='{ "format": "backtest-settings", "strategy": "breakout_range", "symbol": "NSE:NIFTY50-INDEX", "settings": { … } }'
                    className="w-full font-mono text-2xs bg-slate-900 border border-line rounded p-2 text-fg-2" />
                <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" className={BTN} onClick={() => fileRef.current && fileRef.current.click()}><Upload className="w-3 h-3" aria-hidden="true" />Choose a .json file</button>
                    <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} aria-label="Strategy JSON file" />
                    {text && <button type="button" className={BTN} onClick={() => setText('')}>Clear</button>}
                </div>

                {parsed && !parsed.ok && <p className="text-danger" role="alert">{parsed.error}</p>}
                {parsed && parsed.ok && (
                    <div className="rounded border border-line/60 p-2 space-y-1.5" data-testid="import-preview">
                        {/* what WILL load (the settings), not the label — a hand-edited JSON keeps its old label */}
                        <p className="text-sm text-fg">
                            {parsed.settings.strategy}{parsed.settings.symbol ? ` on ${shortSym(parsed.settings.symbol)}` : ''}
                            {parsed.settings.resolution ? <span className="text-fg-5"> · {parsed.settings.resolution}m</span> : null}
                        </p>
                        <p className="text-2xs text-fg-5">
                            {parsed.meta.label ? `“${parsed.meta.label}” · ` : ''}{parsed.meta.source ? `from ${parsed.meta.source}` : ''}{parsed.meta.exportedAt ? ` · exported ${istDateTime(parsed.meta.exportedAt)}` : ''}
                        </p>
                        <ResultsLine results={parsed.meta.results} />
                        <div className="flex items-center gap-2 flex-wrap">
                            <StatusBadge level={changes.length ? 'info' : 'good'}>{changes.length ? `${changes.length - cleared} setting${changes.length - cleared === 1 ? '' : 's'} will change${cleared ? `, ${cleared} cleared` : ''}` : 'Same as your current settings'}</StatusBadge>
                            {changes.length > 0 && (
                                <button type="button" className={BTN} onClick={() => setShowChanges((s) => !s)} aria-expanded={showChanges}>
                                    {showChanges ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                                    {showChanges ? 'Hide changes' : 'Show changes'}
                                </button>
                            )}
                        </div>
                        {showChanges && (
                            <ul className="max-h-56 overflow-auto text-2xs font-mono space-y-0.5" data-testid="import-changes">
                                {changes.map((c) => (
                                    <li key={c.key}><span className="text-fg-4">{c.key}</span>: <span className="text-fg-5 line-through">{show(c.from)}</span> → {c.removed ? <span className="text-fg-5 italic">cleared (not in this strategy)</span> : <span className="text-fg-2">{show(c.to)}</span>}</li>
                                ))}
                            </ul>
                        )}
                        {parsed.warnings.map((w, i) => <p key={i} className="text-2xs text-warning">⚠ {w}</p>)}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export default function StrategyJsonControls({ params, onImport, knownStrategies = null, buildNext = null }) {
    const [importOpen, setImportOpen] = useState(false);
    const json = () => buildStrategyJson(params, { source: 'backtest', label: `${params.strategy || 'strategy'} on ${shortSym(params.symbol)} — Backtester settings` });
    const copy = async () => {
        const ok = await copyText(strategyJsonText(json()));
        if (ok) toast.success('Settings JSON copied — paste it into Import JSON (here or on another machine)');
        else toast.error('Could not copy — use Download instead');
    };
    const download = () => { const j = json(); downloadJson(j, jsonFileName(j)); };
    return (
        <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Copy, download or import settings">
            <button type="button" className={BTN} onClick={copy} disabled={!params?.strategy} title="Copy every current setting as JSON">
                <Copy className="w-3 h-3" aria-hidden="true" />Copy JSON
            </button>
            <button type="button" className={BTN} onClick={download} disabled={!params?.strategy} title="Save every current setting as a .json file">
                <Download className="w-3 h-3" aria-hidden="true" />Download
            </button>
            <button type="button" className={BTN} onClick={() => setImportOpen(true)} title="Load settings from a strategy JSON (from here or from the Optimizer)">
                <Upload className="w-3 h-3" aria-hidden="true" />Import JSON
            </button>
            <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} current={params || {}} onImport={onImport} knownStrategies={knownStrategies} buildNext={buildNext} />
        </div>
    );
}
