/**
 * AttentionStrip — the top of the Dashboard: what needs you right now, in one
 * line each (the three most urgent), and a link to the full list. Renders
 * nothing when all is clear, so a healthy day looks like a calm page.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { StatusBadge } from '../viz/primitives';
import useNotificationSummary from '../../hooks/useNotificationSummary.js';
import { sevOf, timeAgo, firstSentence } from './notifyFormat.js';

export default function AttentionStrip({ max = 3 }) {
    const { summary } = useNotificationSummary();
    const items = (summary?.top || []).filter((n) => n.severity !== 'info');
    if (!items.length) return null;
    const urgent = items.some((n) => n.severity === 'critical');
    return (
        <section aria-label="Needs attention" data-testid="attention-strip"
            className={`rounded-xl border px-4 py-3 space-y-2 ${urgent ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
                    <AlertTriangle className={`w-4 h-4 ${urgent ? 'text-danger' : 'text-warning'}`} aria-hidden="true" />
                    Needs attention ({summary.unread})
                </h2>
                <Link to="/notifications" className="inline-flex items-center gap-1 text-2xs text-primary-ink hover:underline">
                    See all and fix <ChevronRight className="w-3 h-3" aria-hidden="true" />
                </Link>
            </div>
            <ul className="space-y-1">
                {items.slice(0, max).map((n) => (
                    <li key={n._id} className="flex items-start gap-2 text-xs">
                        <StatusBadge level={sevOf(n.severity).level}>{sevOf(n.severity).label}</StatusBadge>
                        <span className="min-w-0">
                            <span className="font-medium text-fg-2">{n.title}</span>
                            {n.message && <span className="text-fg-4"> — {firstSentence(n.message)}</span>}
                            <span className="text-3xs text-fg-5"> · {timeAgo(n.lastAt || n.firstAt)}</span>
                        </span>
                    </li>
                ))}
            </ul>
            {items.length > max && <p className="text-3xs text-fg-5">and {items.length - max} more</p>}
        </section>
    );
}
