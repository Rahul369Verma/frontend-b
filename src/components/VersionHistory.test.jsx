/**
 * History and restore (27-Oct-2026): the versions with what each changed, a dry run before any
 * restore, a refusal shown as such, and a LIVE deployment restored only after typing its name.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const HISTORY = {
    kind: 'multileg-deployment', id: 'd1', name: 'straddle (LIVE)', exists: true, currentVersion: 3, driftedSinceNewest: false,
    versions: [
        { version: 3, at: '2026-10-27T05:00:00Z', source: 'changed', changes: [{ key: 'params.max_loss_rupees', before: null, after: 3000 }] },
        { version: 2, at: '2026-10-24T05:00:00Z', source: 'changed', changes: [{ key: 'params.leg_sl_x', before: 1.4, after: 1.5 }] },
        { version: 1, at: '2026-10-20T05:00:00Z', source: 'as it was before history was kept', changes: [] },
    ],
    earlierEdits: [{ at: '2026-10-19T05:00:00Z', changes: [{ key: 'lots', before: 1, after: 2 }] }],
};
let restorePosts = [];
let refuse = false;
vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/\/versions\/deleted\//.test(url)) return Promise.resolve({ data: { deleted: [{ refId: 'gone1', name: 'old one', at: '2026-10-26T05:00:00Z', version: 4 }] } });
        if (/\/versions\//.test(url)) return Promise.resolve({ data: HISTORY });
        return Promise.resolve({ data: {} });
    });
    const post = vi.fn((url, body) => {
        restorePosts.push({ url, body });
        if (refuse) return Promise.resolve({ status: 422, data: { ok: false, errors: ['a LIVE deployment cannot be sized up here'], changes: [] } });
        return Promise.resolve({ data: { ok: true, dryRun: !!body.dryRun, via: 'the running engine', changes: [
            { key: 'max_loss_rupees', before: 3000, after: null, appliesTo: 'the next entry' },
            { key: 'leg_sl_x', before: 1.5, after: 1.4, appliesTo: 'the next entry' },
        ] } });
    });
    const api = { get, post, defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
vi.mock('./toastStore.js', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import VersionHistory, { DeletedStrategies } from './VersionHistory.jsx';
import ConfirmProvider from './ConfirmDialog.jsx';
import { toast } from './toastStore.js';
import { changeLine, valueText } from './versionFormat.js';

const show = (props = {}) => render(
    <ConfirmProvider>
        <VersionHistory kind="multileg-deployment" id="d1" name="straddle (LIVE)" live open onClose={() => {}} {...props} />
    </ConfirmProvider>,
);

describe('versionFormat', () => {
    it('says what changed in words', () => {
        expect(changeLine({ key: 'params.leg_sl_x', before: 1.4, after: 1.5 })).toBe('leg_sl_x: 1.4 → 1.5');
        expect(changeLine({ key: 'params.max_loss_rupees', before: null, after: 3000 })).toBe('max_loss_rupees: not set → 3000');
        expect(changeLine({ key: 'backtest', before: { a: 1 }, after: '(changed)' })).toBe('backtest: changed');
        expect(valueText(true)).toBe('on');
        expect(valueText({ a: 'x'.repeat(80) }).endsWith('…')).toBe(true);
    });
});

describe('VersionHistory', () => {
    beforeEach(() => { restorePosts = []; refuse = false; vi.mocked(toast.success).mockClear(); });

    it('lists the versions newest first with what each changed; the current one has no Restore', async () => {
        show();
        await waitFor(() => expect(screen.getByTestId('version-history')).toBeTruthy());
        const items = within(screen.getByLabelText('Versions, newest first')).getAllByRole('listitem').filter((li) => /^v\d/.test(li.textContent));
        expect(items.map((li) => li.textContent.match(/^v(\d)/)[1])).toEqual(['3', '2', '1']);
        expect(items[0].textContent).toMatch(/current/);
        expect(items[0].textContent).toMatch(/max_loss_rupees: not set → 3000/);
        expect(within(items[0]).queryByRole('button')).toBeNull();
        expect(within(items[2]).getByRole('button', { name: 'Restore version 1' })).toBeTruthy();
        expect(screen.getByText(/the first recorded state/)).toBeTruthy();
        // the older edit log is shown, and says it cannot be restored
        expect(screen.getByText(/Earlier edits/).textContent).toMatch(/cannot be restored/);
        expect(screen.getByText(/lots: 1 → 2/)).toBeTruthy();
    });

    it('a restore is a dry run first, then a LIVE deployment needs its name typed', async () => {
        const onRestored = vi.fn();
        show({ onRestored });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));
        await waitFor(() => expect(screen.getByTestId('restore-plan')).toBeTruthy());
        expect(restorePosts).toEqual([{ url: expect.stringMatching(/\/versions\/multileg-deployment\/d1\/1\/restore$/), body: { dryRun: true } }]);
        const plan = screen.getByTestId('restore-plan').textContent;
        expect(plan).toMatch(/via the running engine/);
        expect(plan).toMatch(/leg_sl_x: 1.5 → 1.4 \(the next entry\)/);
        fireEvent.click(within(screen.getByTestId('restore-plan')).getByRole('button', { name: /Restore version 1/ }));
        // the confirm: LIVE → type the name
        await waitFor(() => expect(screen.getByText(/Type/)).toBeTruthy());
        const confirmBtn = screen.getByRole('button', { name: 'Restore' });
        expect(confirmBtn.disabled).toBe(true);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'straddle (LIVE)' } });
        expect(confirmBtn.disabled).toBe(false);
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(onRestored).toHaveBeenCalled());
        expect(restorePosts.at(-1).body).toEqual({});
        expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Restored version 1 of “straddle \(LIVE\)” \(2 change\(s\)\)/));
    });

    it('a refused restore says why and offers no button to force it', async () => {
        refuse = true;
        show();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Restore version 2' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Restore version 2' }));
        await waitFor(() => expect(screen.getByText(/Refused: a LIVE deployment cannot be sized up here/)).toBeTruthy());
        expect(within(screen.getByTestId('restore-plan')).getByRole('button', { name: /Restore version 2/ }).disabled).toBe(true);
    });

    it('deleted strategies are listed and open their history', async () => {
        render(<ConfirmProvider><DeletedStrategies kind="multileg-strategy" open onClose={() => {}} /></ConfirmProvider>);
        await waitFor(() => expect(screen.getByTestId('deleted-strategies')).toBeTruthy());
        expect(screen.getByText('old one')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /History/ }));
        await waitFor(() => expect(screen.getByTestId('version-history')).toBeTruthy());
    });
});
