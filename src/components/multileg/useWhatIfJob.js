/**
 * useWhatIfJob — one deployment's what-if grid on the recorded prices, run as a server job
 * (GET /api/multileg/deployments/:id/stop-grid | target-grid | combo-grid; backend logic/services/stopWhatIf.js).
 *
 * Replays are SAVED on the server (user, 18-Nov-2026: "save the replay so it will not calculate again and
 * again; it will show the history and we can recalculate it anytime, which replaces the saved one"):
 *   • on opening it only PEEKS (?peek=1): a saved replay is shown at once, a running one is followed,
 *     and nothing is computed;
 *   • `start` computes one when none is saved;
 *   • `recalc` computes it again (?recalc=1) and replaces the saved one; the saved one stays on screen
 *     until the new one is done.
 * Polled every 2 s while it runs. Keyed by deployment: switching the Results filter shows the new
 * deployment's own, and an answer for the old one is ignored.
 */
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';

/** Server states that mean "still working" (the job is written to the saved copy last: 'saving'). */
export const BUSY = new Set(['queued', 'loading', 'running', 'saving']);

export default function useWhatIfJob(kind, deploymentId, limit = 30) {
    const [state, setSt] = useState({ id: null, status: 'idle' });
    const st = state.id === deploymentId ? state : { status: 'idle' };
    const timer = useRef(null);
    const live = useRef(deploymentId);
    live.current = deploymentId;

    const ask = (id, extra = {}) => axios.get(`${API_URL}/multileg/deployments/${id}/${kind}`, { params: { limit, ...extra }, timeout: 60000 })
        .then((r) => {
            if (live.current !== id) return;
            const status = r.data.status === 'none' ? 'idle' : r.data.status;
            setSt({ id, status, job: r.data });
            if (BUSY.has(r.data.status)) timer.current = setTimeout(() => ask(id), 2000);
        })
        .catch((e) => { if (live.current === id) setSt({ id, status: 'error', error: e.response?.data?.error || e.message }); });

    // on opening: the saved replay (or the one running), never a new computation
    useEffect(() => {
        clearTimeout(timer.current);
        if (deploymentId && deploymentId !== 'all') ask(deploymentId, { peek: 1 });
        return () => clearTimeout(timer.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per deployment (and size)
    }, [deploymentId, kind, limit]);

    const run = (extra) => {
        clearTimeout(timer.current);
        setSt((s) => ({ id: deploymentId, status: 'queued', job: s.id === deploymentId ? s.job : undefined }));
        ask(deploymentId, extra);
    };
    return { st, job: st.job, res: st.job?.result, start: () => run({}), recalc: () => run({ recalc: 1 }) };
}
