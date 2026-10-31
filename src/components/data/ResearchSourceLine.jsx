/**
 * ResearchSourceLine — where a backtest's RECORDED prices come from (the option-chain
 * archive and the quote tape), and whether that source answers right now.
 *
 * On dev it is production's database, read-only, through the prod_db_tunnel SSH container
 * (backend/ops/dev/README.md); on production, its own database. A source that does not
 * answer says why (the server names the tunnel), so a replay that finds nothing is not
 * mistaken for a market that recorded nothing.
 * Backend: GET /api/data/research-source?ping=1 (logic/services/archiveSource.js).
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';

export default function ResearchSourceLine({ className = '' }) {
    const [st, setSt] = useState(null);
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        let dead = false;
        axios.get(`${API_URL}/data/research-source`, { params: { ping: 1 }, timeout: 20000 })
            .then((r) => { if (!dead) setSt(r.data); })
            .catch((e) => { if (!dead) setSt({ error: e?.response?.data?.error || e.message, connected: false }); });
        return () => { dead = true; };
    }, [nonce]);
    if (!st) return <div className={`text-3xs text-fg-5 ${className}`}>Checking where recorded prices come from…</div>;
    const ok = st.connected && !st.error;
    return (
        <div className={`text-3xs ${ok ? 'text-fg-5' : 'text-danger'} ${className}`} data-testid="research-source" role={ok ? undefined : 'alert'}>
            Recorded prices from: <b className={ok ? 'text-fg-3' : ''}>{st.configured === false ? "this stack's own database" : st.source || 'the recorded-data source'}</b>
            {ok ? <>{st.pingMs != null ? ` · answers in ${st.pingMs} ms` : ''}{st.configured === false ? ' (on dev it is empty unless secrets.dev.env points at production — see backend/ops/dev/README.md)' : ''}</>
                : <> · not answering{st.error ? `: ${st.error}` : ''} <button type="button" className="underline ml-1" onClick={() => setNonce((n) => n + 1)}>check again</button></>}
        </div>
    );
}
