import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';

/**
 * GET /api/multileg/scorecard under the page's filters. Shared by the "Open
 * now" strip and the Strategies card, which sit apart on the page but read one
 * response. The answer carries the request it belongs to, so a filter change
 * never paints the previous filter's rows under the new heading.
 */
export default function useScorecard(params, nonce = 0) {
    const reqKey = JSON.stringify([params, nonce]);
    const [res, setRes] = useState({ key: null, data: null, err: null });
    useEffect(() => {
        let dead = false;
        axios.get(`${API_URL}/multileg/scorecard`, { params })
            .then(r => { if (!dead) setRes({ key: reqKey, data: r.data || null, err: null }); })
            .catch(e => { if (!dead) setRes({ key: reqKey, data: null, err: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [reqKey, params]);
    const fresh = res.key === reqKey;
    return { data: fresh ? res.data : null, err: fresh ? res.err : null, loading: !fresh };
}
