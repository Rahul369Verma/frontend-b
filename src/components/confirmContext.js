import { createContext, useContext } from 'react';

/**
 * Context + hook for the themed confirm dialog, kept in a NON-component file.
 *
 * Fast Refresh only preserves state for modules that export components and
 * nothing else, so exporting `useConfirm` from the same file as
 * `ConfirmProvider` would make every edit to the dialog blow away app state.
 * (The same rule is why AuthContext.jsx and GlobalContext.jsx are flagged.)
 */
export const ConfirmContext = createContext(null);

/**
 * useConfirm() -> (messageOrOptions) => Promise<boolean>
 *
 * Outside a provider this falls back to `window.confirm` rather than throwing:
 * a component that asks a destructive question should still ask it, even
 * un-themed, rather than silently proceeding or crashing.
 */
export function useConfirm() {
    const ctx = useContext(ConfirmContext);
    return ctx ?? ((opts) => Promise.resolve(
        window.confirm(typeof opts === 'string' ? opts : (opts?.body || opts?.title || 'Are you sure?')),
    ));
}
