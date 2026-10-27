/**
 * useWhatIfJob — one deployment's what-if grid on the recorded option chain, run as a server job
 * (GET /api/multileg/deployments/:id/stop-grid or /target-grid; backend logic/services/stopWhatIf.js).
 *
 * Idle until asked (`start`), then polled every 2 s until it is done or failed. Keyed by
 * deployment: switching the Results filter shows the new deployment idle, and a poll that
 * answers for the old one is ignored.
 */
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';

export default function useWhatIfJob(kind, deploymentId, limit = 30) {
    const [state, setSt] = useState({ id: null, status: 'idle' });
    const st = state.id === deploymentId ? state : { status: 'idle' };
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), [deploymentId]);

    const poll = (id) => {
        axios.get(`${API_URL}/multileg/deployments/${id}/${kind}`, { params: { limit }, timeout: 60000 })
            .then((r) => {
                setSt({ id, status: r.data.status, job: r.data });
                if (r.data.status !== 'done' && r.data.status !== 'failed') timer.current = setTimeout(() => poll(id), 2000);
            })
            .catch((e) => setSt({ id, status: 'error', error: e.response?.data?.error || e.message }));
    };
    const start = () => { clearTimeout(timer.current); setSt({ id: deploymentId, status: 'queued' }); poll(deploymentId); };
    return { st, job: st.job, res: st.job?.result, start };
}
