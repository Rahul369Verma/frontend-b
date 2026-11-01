import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_ORIGIN } from '../config/api.js';

/**
 * useLiveRoom — live data PUSHED by the server instead of polled (31-Oct-2026).
 *
 * The backend streams each page's live data to a socket.io ROOM (backend
 * logic/services/liveStream.js): a page joins the room of what it shows and receives it the
 * moment it changes; other pages receive nothing. Every page shares ONE connection (opened by
 * the first user, closed by the last), so opening three panels never opens three sockets.
 *
 * The room is re-joined on every reconnect. The hook returns whether the stream is connected:
 * a page polls slowly while it is (a missed event heals at the next poll) and at its old pace
 * when it is not — the stream is never the only way the data arrives.
 *
 * @param {string} room            e.g. 'multileg'
 * @param {Object<string, Function>} handlers  event → handler; the latest closures are always called
 * @param {{enabled?: boolean}} [options]
 * @returns {boolean} connected
 */
let shared = null;
let users = 0;
const acquire = () => { if (!shared) shared = io(API_ORIGIN, { withCredentials: true }); users++; return shared; };
const release = () => { users = Math.max(0, users - 1); if (!users && shared) { shared.disconnect(); shared = null; } };

export function useLiveRoom(room, handlers, { enabled = true } = {}) {
    const saved = useRef(handlers);
    useEffect(() => { saved.current = handlers; }, [handlers]);
    const [connected, setConnected] = useState(false);
    useEffect(() => {
        if (!enabled || !room) return undefined;
        const s = acquire();
        const join = () => { s.emit('subscribe', room); setConnected(true); };
        const lost = () => setConnected(false);
        const listeners = Object.keys(saved.current || {}).map((ev) => [ev, (payload) => saved.current?.[ev]?.(payload)]);
        for (const [ev, fn] of listeners) s.on(ev, fn);
        s.on('connect', join);
        s.on('disconnect', lost);
        if (s.connected) join();
        return () => {
            if (s.connected) s.emit('unsubscribe', room);
            for (const [ev, fn] of listeners) s.off(ev, fn);
            s.off('connect', join);
            s.off('disconnect', lost);
            release();
            setConnected(false);
        };
    }, [room, enabled]);
    return connected;
}

export default useLiveRoom;
