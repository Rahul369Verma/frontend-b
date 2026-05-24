import React, { useState, useRef, useEffect } from 'react';
import { Lock, Shield, Eye, EyeOff, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * LoginPage — single-password gate. No "forgot password" / "signup" since
 * this is a single-operator dashboard. Backend has the shared LOGIN_PASSWORD;
 * we just submit it and let it set the HttpOnly cookie.
 */
export default function LoginPage() {
    const { login, error } = useAuth();
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!password || busy) return;
        setBusy(true);
        try {
            await login(password);
            // On success, AuthGate will swap to the app automatically.
        } finally {
            setBusy(false);
            setPassword('');  // Always clear after attempt
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
            {/* Background flair */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                <div className="bg-surface border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
                    {/* Header */}
                    <div className="p-8 pb-6 border-b border-slate-700/50">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
                                <Shield className="w-5 h-5 text-violet-400" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">AlgoBot Dashboard</h1>
                                <p className="text-xs text-slate-500">Authentication required</p>
                            </div>
                        </div>
                    </div>

                    {/* Form */}
                    <form onSubmit={onSubmit} className="p-8 space-y-5">
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input
                                    ref={inputRef}
                                    type={show ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Enter dashboard password"
                                    autoComplete="current-password"
                                    disabled={busy}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-12 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShow(s => !s)}
                                    tabIndex={-1}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                >
                                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-sm text-red-200">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={busy || !password}
                            className={`w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                                busy || !password
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20'
                            }`}
                        >
                            {busy ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                            ) : (
                                <>🔓 Unlock Dashboard</>
                            )}
                        </button>

                        {/* Info */}
                        <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                            Session is valid for <span className="text-slate-400 font-mono">4 days</span>.
                            Your password is verified server-side; a signed HttpOnly cookie
                            keeps you logged in.
                        </p>
                    </form>
                </div>

                {/* Footer hint */}
                <p className="text-center text-[10px] text-slate-600 mt-4">
                    🔒 Rate-limited · HMAC-signed · HttpOnly · SameSite
                </p>
            </div>
        </div>
    );
}
