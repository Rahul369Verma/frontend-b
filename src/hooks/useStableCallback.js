'use strict';
import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback whose IDENTITY never changes but which always runs the latest `fn`.
 *
 * Handing a memoised child (React.memo) an inline handler defeats the memo: the
 * handler is a new function on every parent render, so the child re-renders
 * anyway. The Dashboard re-renders on every 2-second socket snapshot and every
 * price tick; its Deployments panel re-rendered with it for exactly this reason.
 */
export default function useStableCallback(fn) {
    const ref = useRef(fn);
    useLayoutEffect(() => { ref.current = fn; });
    return useCallback((...args) => (ref.current ? ref.current(...args) : undefined), []);
}
