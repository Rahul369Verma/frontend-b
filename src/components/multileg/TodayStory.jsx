/**
 * TodayStory — a deployment's day on its card: the reason that matters (headline) and, on demand,
 * every decision and outcome since the morning (user, 27-Oct-2026: "nowhere on the card can I see
 * why we have no entry for the second leg — show all the reasons for today in the card").
 * Data: GET /api/multileg/today (backend logic/multileg/dayStory.js), fetched by the page.
 */
import React, { useState } from 'react';
import { TONE_CLASS, times } from './tradeStoryFormat.js';

export default function TodayStory({ story, istTime }) {
    const [open, setOpen] = useState(false);
    if (!story || (!story.headline && !(story.lines || []).length)) return null;
    const lines = story.lines || [];
    const t = (v) => (istTime ? istTime(v) : String(v).slice(11, 16));
    return (
        <div className="text-3xs mb-2" data-testid="today-story">
            <div className="flex items-start gap-1.5">
                <span className="text-fg-5 shrink-0">Today:</span>
                <span className={story.headline ? (TONE_CLASS[story.headline.tone] || 'text-fg-4') : 'text-fg-5'}>
                    {story.headline ? story.headline.text : 'nothing to report'}
                </span>
                {lines.length > 0 && (
                    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
                        className="ml-auto shrink-0 text-fg-5 hover:text-fg-3 underline">{open ? 'hide' : `all today (${lines.length + (story.hidden || 0)})`}</button>
                )}
            </div>
            {open && (
                <ul className="mt-1 space-y-0.5 font-mono">
                    {story.hidden > 0 && <li className="text-fg-5">… {story.hidden} earlier line(s) not shown</li>}
                    {lines.map((l, i) => (
                        <li key={i}>
                            <span className="text-fg-5">{t(l.at)}{l.count > 1 && l.lastAt !== l.at ? `–${t(l.lastAt)}` : ''}</span>{' '}
                            <span className={TONE_CLASS[l.tone] || 'text-fg-4'}>{l.label}{times(l.count)}</span>
                            <span className="text-fg-4">: {l.text}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
