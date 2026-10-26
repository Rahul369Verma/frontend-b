/**
 * NewTabLink — the small ↗ after a strategy's name: the SAME results page that clicking
 * the name opens, but in a new browser tab (user, 23-Oct-2026: "with each strategy, at the
 * end of its name, a go-to-new-tab icon … everywhere we show a strategy click").
 *
 * A real <a target="_blank">, so middle-click, ctrl-click and "copy link" work too. It never
 * triggers its row: a click on it does not bubble to a row that expands or filters.
 *
 * NameWithNewTab puts a name link and its icon on one line: the name truncates, the icon
 * always stays visible after it.
 */
import React from 'react';
import { ExternalLink } from 'lucide-react';

export default function NewTabLink({ href, label = 'this strategy', className = '' }) {
    if (!href) return null;
    return (
        <a href={href} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`Open ${label}'s results in a new tab`} aria-label={`Open ${label}'s results in a new tab`}
            className={`inline-flex items-center shrink-0 p-0.5 rounded text-fg-5 hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
    );
}

/** `name` (usually a router <Link>) + its new-tab icon, on one line that truncates the name only. */
export function NameWithNewTab({ href, label, children, className = '' }) {
    return (
        <span className={`flex items-center gap-0.5 min-w-0 ${className}`}>
            <span className="min-w-0 truncate">{children}</span>
            <NewTabLink href={href} label={label} />
        </span>
    );
}
