import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

export default function Callback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Processing login...");

  useEffect(() => {
    const authCode = searchParams.get('auth_code');
    if (authCode) {
      handleAuth(authCode);
    } else {
      setStatus("No auth code found.");
    }
  }, []);

  const handleAuth = async (code) => {
    try {
      await axios.post(`${API_URL}/auth/fyers/callback`, { auth_code: code });
      setStatus("Login Successful! Redirecting...");
      setTimeout(() => navigate('/settings'), 1500);
    } catch (err) {
      setStatus("Login Failed: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background text-white">
      <div className="bg-surface p-8 rounded-xl border border-slate-700 text-center">
        <h2 className="text-2xl font-bold mb-4">Fyers Authentication</h2>
        <p className="text-slate-400">{status}</p>
      </div>
    </div>
  );
}
