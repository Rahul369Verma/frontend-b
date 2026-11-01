import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

const sockets = [];
vi.mock('socket.io-client', () => ({
    io: vi.fn(() => {
        const handlers = {};
        const s = {
            connected: false, emitted: [], disconnected: false,
            on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
            off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
            emit: (ev, arg) => s.emitted.push([ev, arg]),
            disconnect: () => { s.disconnected = true; },
            fire: (ev, arg) => (handlers[ev] || []).forEach((f) => f(arg)),
        };
        sockets.push(s);
        return s;
    }),
}));
const { useLiveRoom } = await import('./useLiveRoom.js');

function Probe({ room, onEvent, onConnected }) {
    const connected = useLiveRoom(room, { multileg_marks: onEvent });
    onConnected(connected);
    return null;
}

describe('useLiveRoom', () => {
    it('one shared connection; joins its room on (re)connect, hands events to the latest handler, leaves and closes when the last user goes', () => {
        const got = [], states = [];
        const a = render(<Probe room="multileg" onEvent={(p) => got.push(p)} onConnected={(c) => states.push(c)} />);
        const b = render(<Probe room="multileg" onEvent={() => {}} onConnected={() => {}} />);
        expect(sockets.length).toBe(1);
        const s = sockets[0];
        act(() => { s.connected = true; s.fire('connect'); });
        expect(s.emitted.filter(([ev]) => ev === 'subscribe')).toEqual([['subscribe', 'multileg'], ['subscribe', 'multileg']]);
        expect(states.at(-1)).toBe(true);
        act(() => s.fire('multileg_marks', { marks: [1] }));
        expect(got).toEqual([{ marks: [1] }]);
        act(() => { s.connected = false; s.fire('disconnect'); });
        expect(states.at(-1)).toBe(false);
        a.unmount();
        expect(s.disconnected).toBe(false);
        b.unmount();
        expect(s.disconnected).toBe(true);
    });
});
