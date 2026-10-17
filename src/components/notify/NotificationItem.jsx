/**
 * NotificationItem — one notification, simple first.
 *
 * The row says what is wrong in one sentence. "Details" opens why it happened
 * and how to fix it; "Open" goes to the page involved; "Acknowledge" says you
 * have seen it (it stays open until the condition clears, but stops nagging).
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, Check } from 'lucide-react';
import { StatusBadge, Chip } from '../viz/primitives';
import { istDateTime } from '../viz/tokens.js';
import { sevOf, catOf, whenLine } from './notifyFormat.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';

function MetaDetail({ meta }) {
    if (!meta || typeof meta !== 'object') return null;
    const deps = Array.isArray(meta.deployments) ? meta.deployments : null;
    const rest = Object.entries(meta).filter(([k, v]) => k !== 'deployments' && v != null && typeof v !== 'object');
    return (
        <div className="space-y-1">
            {deps && deps.length > 0 && (
                <p className="text-2xs text-fg-4">Affects: {deps.map((d) => d.name || d.id).join(', ')}</p>
            )}
            {rest.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-3xs text-fg-5">
                    {rest.map(([k, v]) => (
                        <React.Fragment key={k}><dt className="font-medium">{k}</dt><dd className="break-all">{String(v)}</dd></React.Fragment>
                    ))}
                </dl>
            )}
        </div>
    );
}

export default function NotificationItem({ n, onAck, compact = false }) {
    const [open, setOpen] = useState(false);
    const sev = sevOf(n.severity);
    const hasDetail = !!(n.reason || n.action || n.meta);
    const external = n.link && /^https?:/.test(n.link);
    return (
        <li className="rounded-lg border border-line/60 bg-card-2/30 px-3 py-2" data-testid="notification">
            <div className="flex items-start gap-2 flex-wrap">
                <StatusBadge level={sev.level}>{sev.label}</StatusBadge>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{n.title}</p>
                    {n.message && <p className={`text-xs text-fg-4 ${compact ? 'line-clamp-2' : ''}`}>{n.message}</p>}
                    <p className="text-3xs text-fg-5 mt-0.5">
                        <Chip tone="muted" className="mr-1">{catOf(n.category)}</Chip>
                        <span title={istDateTime(n.lastAt || n.firstAt)}>{whenLine(n)}</span>
                    </p>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                    {hasDetail && (
                        <button type="button" className={BTN} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                            {open ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                            {open ? 'Hide details' : 'Details'}
                        </button>
                    )}
                    {n.link && (external
                        ? <a className={BTN} href={n.link} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" aria-hidden="true" />Open</a>
                        : <Link className={BTN} to={n.link}><ExternalLink className="w-3 h-3" aria-hidden="true" />Open</Link>)}
                    {onAck && !n.ackAt && n.status !== 'resolved' && (
                        <button type="button" className={BTN} onClick={() => onAck(n)} title="I have seen this — stop reminding me (it stays listed until it clears)">
                            <Check className="w-3 h-3" aria-hidden="true" />Acknowledge
                        </button>
                    )}
                </div>
            </div>
            {open && (
                <div className="mt-2 pl-1 space-y-1.5 border-t border-line-0 pt-2">
                    {n.reason && <p className="text-xs text-fg-3"><span className="font-semibold">Why: </span>{n.reason}</p>}
                    {n.action && <p className="text-xs text-fg-3"><span className="font-semibold">How to fix: </span>{n.action}</p>}
                    {n.resolution && <p className="text-xs text-success"><span className="font-semibold">Resolved: </span>{n.resolution}</p>}
                    <MetaDetail meta={n.meta} />
                    <p className="text-3xs text-fg-5">First seen {istDateTime(n.firstAt)} · last {istDateTime(n.lastAt)}{n.key ? ` · ${n.key}` : ''}</p>
                </div>
            )}
        </li>
    );
}
