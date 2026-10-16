/**
 * DocLink — the small book icon next to a section title that opens that
 * section's documentation (/docs/<page>#<section>) in a new tab, so reading the
 * docs never loses your place in the app.
 *
 * Deliberately knows nothing but the target: importing the docs registry here
 * would pull every page of documentation into every page's bundle. That every
 * target exists is enforced by src/docs/docs.test.js instead.
 *
 *   <DocLink to="dashboard#direction-confidence" />
 *   <Card docs="multi-leg#results-tab" … />   (Card / CollapsibleCard render it for you)
 */
import React from 'react';
import { BookOpen } from 'lucide-react';

function docHref(to) {
    const [page, section] = String(to || '').split('#');
    return `/docs/${page || ''}${section ? `#${section}` : ''}`;
}

export default function DocLink({ to, label = null, className = '' }) {
    if (!to) return null;
    return (
        <a href={docHref(to)} target="_blank" rel="noopener noreferrer" data-doc-link={to}
            title="What is this? Open the explanation of this section (new tab)"
            aria-label="Open the documentation for this section (opens in a new tab)"
            className={`inline-flex items-center gap-1 text-fg-5 hover:text-primary-ink align-middle ${className}`}>
            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
            {label && <span className="text-2xs font-normal">{label}</span>}
        </a>
    );
}
