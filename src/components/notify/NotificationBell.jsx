/**
 * NotificationBell — the rail's link to /notifications, with a count of what
 * needs attention (urgent + warnings not yet acknowledged). Red when anything is
 * urgent, amber for warnings, plain when all clear. Collapsed rail: icon only,
 * the count and label survive as the accessible name and tooltip.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, BellRing } from 'lucide-react';
import useNotificationSummary from '../../hooks/useNotificationSummary.js';
import { badgeOf } from './notifyFormat.js';

export default function NotificationBell({ collapsed = false, focusClass = '' }) {
    const { summary } = useNotificationSummary();
    const b = badgeOf(summary);
    const active = useLocation().pathname === '/notifications';
    const Icon = b.count ? BellRing : Bell;
    const dot = b.level === 'critical' ? 'bg-danger text-on-primary' : 'bg-warning text-on-primary';
    return (
        <Link to="/notifications" title={b.label} aria-label={b.label} aria-current={active ? 'page' : undefined}
            className={`relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-3'} py-2 rounded-lg transition-colors ${focusClass} ${
                active ? 'bg-primary/10 text-primary-ink' : b.level === 'critical' ? 'text-danger hover:bg-fg/10' : 'text-fg-4 hover:bg-fg/10 hover:text-fg'}`}>
            <span className="relative flex-shrink-0">
                <Icon className="w-5 h-5" aria-hidden="true" />
                {b.count > 0 && (
                    <span className={`absolute -top-1.5 -right-2 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-4xs font-bold leading-[1.1rem] text-center ${dot}`}
                        aria-hidden="true">{b.count > 99 ? '99+' : b.count}</span>
                )}
            </span>
            {!collapsed && <span className="font-medium text-sm">Notifications</span>}
        </Link>
    );
}
