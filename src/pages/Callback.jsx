import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config/api.js';


export default function Callback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // The "no auth code" case is not an event, it is a fact about the URL we were
  // opened with — so it is derived as the INITIAL state rather than written by an
  // effect after a first render that showed the wrong message. That also removes
  // the setState-inside-effect, which React flags because it renders once, then
  // immediately renders again.
  const authCode = searchParams.get('auth_code');
  const [status, setStatus] = useState(
    authCode ? "Processing login..." : "No auth code found.",
  );

  // Declared BEFORE the effect that calls it. `const` is not hoisted, so the
  // previous order relied on the effect running after the whole component body
  // had evaluated — true today, but it meant the effect closed over a binding
  // that did not exist when the effect was written, which React's lint flags
  // because it silently breaks the moment the call becomes synchronous.
  const handleAuth = useCallback(async (code) => {
    try {
      await axios.post(`${API_URL}/auth/fyers/callback`, { auth_code: code });
      setStatus("Login Successful! Redirecting...");
      setTimeout(() => navigate('/settings'), 1500);
    } catch (err) {
      setStatus("Login Failed: " + (err.response?.data?.error || err.message));
    }
  }, [navigate]);

  useEffect(() => {
    if (authCode) handleAuth(authCode);
  }, [authCode, handleAuth]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background text-fg">
      <div className="bg-surface p-8 rounded-xl border border-line text-center">
        <h2 className="text-2xl font-bold mb-4">Fyers Authentication</h2>
        <p className="text-fg-4">{status}</p>
      </div>
    </div>
  );
}
