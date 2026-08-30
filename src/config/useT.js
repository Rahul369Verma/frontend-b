'use strict';
/**
 * useT — the component-facing door to `strings.js`.
 *
 *     const t = useT();
 *     <span>{t('sidebar.systemOnline')}</span>
 *     <span>{t('sidebar.session', { time: '3h 20m' })}</span>
 *
 * WHY A HOOK FOR SOMETHING THAT IS A PLAIN FUNCTION
 * Today `t` is module state, so this hook does nothing a bare import would not.
 * That is the point: components adopt the hook now, and if the catalog ever
 * grows a runtime dimension (a locale from the user's profile, a per-deployment
 * wording override) that dimension arrives via context INSIDE this file and
 * every call site keeps working untouched. Getting the indirection in early is
 * free; retrofitting it across 24k LOC of JSX is not.
 *
 * The returned function is REFERENTIALLY STABLE (it is the module-level `t`), so
 * it is safe in a `useMemo`/`useCallback`/`useEffect` dependency array and will
 * never be the reason a memo recomputes.
 *
 * No React import: there is no hook call to make yet, and importing React here
 * purely to look like a hook would drag the catalog into the React graph for
 * nothing. A Node script can still import this module.
 */
import { t } from './strings.js';

/** @returns {(key: string, vars?: Record<string, unknown>) => string} */
export function useT() {
    return t;
}

export default useT;
