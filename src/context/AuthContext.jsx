import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';

/**
 * AuthContext — single-password gate for the whole app.
 *
 * Status values:
 *   'checking'        initial — calling /api/auth/check
 *   'authenticated'   cookie valid; show app
 *   'unauthenticated' show login screen
 *   'disabled'        backend has no LOGIN_PASSWORD set; auth turned off
 *
 * The session token is in an HttpOnly cookie set by the backend, so React
 * never touches it directly. We just remember the boolean here.
 */
const AuthContext = createContext(null);
const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

export function AuthProvider({ children }) {
    const [status, setStatus] = useState('checking');
    const [expiresAt, setExpiresAt] = useState(null);
    const [error, setError] = useState(null);

    const checkSession = useCallback(async () => {
        try {
            const res = await axios.get(`${API_URL}/auth/check`, { withCredentials: true });
            if (res.data?.mode === 'disabled') {
                setStatus('disabled');
            } else if (res.data?.authenticated) {
                setStatus('authenticated');
                setExpiresAt(res.data.expiresAt || null);
            } else {
                setStatus('unauthenticated');
            }
        } catch (err) {
            // 401 → not logged in. Anything else → treat as unauth and show login.
            setStatus('unauthenticated');
        }
    }, []);

    useEffect(() => { checkSession(); }, [checkSession]);

    // ── 401 interceptor: if any API call returns 401, force re-login ────────
    // Stored as a global axios interceptor so EVERY axios call in the app
    // benefits (including those in pages we never touched).
    useEffect(() => {
        // Ensure all axios calls send the auth cookie by default.
        axios.defaults.withCredentials = true;
        const id = axios.interceptors.response.use(
            (resp) => resp,
            (err) => {
                const url = err?.config?.url || '';
                // Don't recurse if the failed call IS the auth check
                if (err?.response?.status === 401 && !url.includes('/auth/')) {
                    setStatus('unauthenticated');
                }
                return Promise.reject(err);
            }
        );
        return () => axios.interceptors.response.eject(id);
    }, []);

    const login = useCallback(async (password) => {
        setError(null);
        try {
            const res = await axios.post(`${API_URL}/auth/login`, { password }, { withCredentials: true });
            setStatus('authenticated');
            setExpiresAt(res.data?.expiresAt || null);
            return { ok: true };
        } catch (err) {
            const data = err?.response?.data || {};
            const code = data.code || 'UNKNOWN';
            const msg = data.error || err.message || 'Login failed';
            if (code === 'RATE_LIMITED') {
                setError(`Too many failed attempts. Try again in ${data.retryAfterSec || 60}s.`);
            } else if (code === 'NOT_CONFIGURED') {
                setError('Server has no password configured. Set LOGIN_PASSWORD in env and restart.');
            } else {
                setError(msg);
            }
            return { ok: false, code, message: msg };
        }
    }, []);

    const logout = useCallback(async () => {
        try { await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true }); } catch (_) {}
        setStatus('unauthenticated');
        setExpiresAt(null);
    }, []);

    return (
        <AuthContext.Provider value={{ status, expiresAt, error, login, logout, refresh: checkSession }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}
