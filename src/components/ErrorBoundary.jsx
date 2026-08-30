import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { STORAGE_KEY } from '../theme/prefs.js';

/**
 * ErrorBoundary — the app had none, so any render-time throw anywhere in the
 * tree unmounted EVERYTHING and left a white page.
 *
 * WHY THAT MATTERED MORE THAN USUAL HERE. This dashboard renders live broker
 * data, so a single malformed field (a null where a number was assumed, an
 * expiry that failed to parse) is enough to take the whole UI down mid-session
 * — including the sidebar, and with it the Appearance button, which is the only
 * route back to the theme panel. A reader who had just switched to a theme they
 * could not read had no way back except clearing site data.
 *
 * WHY IT IS APPLIED PER-ROUTE, NOT JUST AT THE ROOT. A single root boundary
 * would replace the entire shell with the fallback. Wrapping each route instead
 * keeps the rail, the theme panel and navigation alive, so a broken page is a
 * broken PANEL rather than a broken app — you can navigate away from it. The
 * root-level boundary is still there underneath, for a throw in the shell itself.
 *
 * `resetKey` lets the parent clear the error without a reload: React Router
 * hands us the pathname, so navigating to another page retries the render
 * rather than leaving the fallback stuck on screen.
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null, info: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Keep the component stack — it is the only thing that says WHICH
        // component threw, and it is gone from the console by the time anyone
        // reads a screenshot.
        this.setState({ info });
        console.error('[ErrorBoundary]', this.props.label || 'app', error, info?.componentStack);
    }

    componentDidUpdate(prev) {
        // A route change is an implicit "try again".
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null, info: null });
        }
    }

    /** Escape hatch: appearance settings are the one piece of persisted state
     *  that can itself cause an unreadable (or crashing) render. */
    resetAppearance = () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
        window.location.reload();
    };

    render() {
        const { error, info } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="p-6" role="alert">
                <div className="max-w-2xl mx-auto bg-card border border-line rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="w-6 h-6 text-danger flex-shrink-0" aria-hidden="true" />
                        <h2 className="text-lg font-bold text-fg">
                            {this.props.label ? `${this.props.label} failed to render` : 'Something went wrong'}
                        </h2>
                    </div>

                    <p className="text-sm text-fg-4">
                        The rest of the app is still running — use the sidebar to go to another page.
                        This is a bug worth reporting; the details below identify it.
                    </p>

                    <pre className="text-2xs font-mono text-fg-5 bg-bg-2 border border-line-0 rounded p-3 overflow-x-auto whitespace-pre-wrap">
                        {String(error?.stack || error?.message || error)}
                        {info?.componentStack ? `\n${info.componentStack}` : ''}
                    </pre>

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => this.setState({ error: null, info: null })}
                            className="btn-primary inline-flex items-center gap-2 text-sm"
                        >
                            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again
                        </button>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
                        >
                            Reload page
                        </button>
                        <button
                            type="button"
                            onClick={this.resetAppearance}
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
                            title="Clears saved theme and accessibility settings, then reloads"
                        >
                            <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reset appearance
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
