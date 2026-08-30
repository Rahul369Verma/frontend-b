import { useEffect } from 'react';

/**
 * useEscapeKey — close-on-Escape for modals and overlays.
 *
 * WHY. The app has eight modal overlays and only three of them handled Escape,
 * so the rest could only be dismissed by clicking a backdrop or hunting for the
 * close button. That is a keyboard trap in practice: the backdrop is a <div>
 * with an onClick, which a keyboard user cannot reach at all.
 *
 * Making the backdrop focusable would be the wrong fix — nobody should tab onto
 * a scrim. Escape is the expected affordance, and it is what the WAI-ARIA dialog
 * pattern specifies.
 *
 * Bound on `document` rather than on the overlay element so it fires regardless
 * of where focus currently sits — a modal that has not yet moved focus into
 * itself would otherwise never see the key.
 *
 * @param {Function} onEscape  called when Escape is pressed
 * @param {boolean}  [enabled=true]  pass the modal's open state
 */
export function useEscapeKey(onEscape, enabled = true) {
    useEffect(() => {
        if (!enabled || typeof onEscape !== 'function') return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onEscape(e); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onEscape, enabled]);
}

export default useEscapeKey;
