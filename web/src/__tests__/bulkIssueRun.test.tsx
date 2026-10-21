import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { mockSessionBackend } from '../test/backend';
import { buildRun, mockBulkIssueBackend, RUN_ID } from '../test/bulkIssue';
import { mockCertificatesBackend } from '../test/certificates';
import { server } from '../test/msw';
import { renderAt } from '../test/render';

// Poll fast so a 16-item run (one item per GET) finishes within a test.
vi.mock('../pages/bulk-issue/constants', () => ({ RUN_POLL_MS: 20 }));

const DONE = 99; // a preloaded, completed run
const SLOW = { timeout: 4000 };
// antd hides the radio input (pointer-events: none); users click the segment label.
const filterBy = (name: string) =>
  userEvent.click(screen.getByRole('radio', { name }).closest('label')!);
const rows = () => screen.findAllByTestId('run-item-row');
const progressText = () => screen.getByTestId('run-progress').textContent ?? '';
const stat = (title: string) =>
  (screen.getByText(title, { selector: '.ant-statistic-title' }).closest('.ant-statistic') as HTMLElement)
    .querySelector('.ant-statistic-content-value')!.textContent;

async function renderCompleted() {
  mockSessionBackend('alice');
  const backend = mockBulkIssueBackend({ preloaded: { [DONE]: 16 } });
  const router = renderAt(`/t/1/bulk-issue/runs/${DONE}`);
  await screen.findByText('Completed');
  return { backend, router };
}

describe('bulk issue run page: result', () => {
  it('shows the header, "16 / 16", final counts and all 16 items for a completed run', async () => {
    await renderCompleted();

    expect(screen.getByRole('heading', { name: 'Fire Safety 2026' })).toBeInTheDocument();
    expect(screen.getByText(/Started by Alice Nguyen/)).toBeInTheDocument();
    expect(screen.getByText('5 Apr 2026, 1:30 am AEDT')).toBeInTheDocument();
    expect(progressText()).toContain('16 / 16');
    expect(screen.getByTestId('run-progress')).toBeInTheDocument();
    expect(stat('Issued')).toBe('8');
    expect(stat('Skipped')).toBe('7');
    expect(stat('Failed')).toBe('1');
    expect(await rows()).toHaveLength(16);
    expect(screen.queryByText('Issuing…')).not.toBeInTheDocument();
  });

  it('filters the items by outcome and back to All', async () => {
    await renderCompleted();
    const tags = () => screen.getAllByTestId('outcome-tag').map((t) => t.textContent);

    await filterBy('Issued');
    expect(await screen.findAllByTestId('run-item-row')).toHaveLength(8);
    expect(new Set(tags())).toEqual(new Set(['Issued']));

    await filterBy('Skipped');
    await waitFor(() => expect(screen.getAllByTestId('run-item-row')).toHaveLength(7));
    expect(new Set(tags())).toEqual(new Set(['Skipped']));

    await filterBy('Failed');
    await waitFor(() => expect(screen.getAllByTestId('run-item-row')).toHaveLength(1));
    expect(screen.getByText('Isla Young')).toBeInTheDocument();

    await filterBy('All');
    await waitFor(() => expect(screen.getAllByTestId('run-item-row')).toHaveLength(16));
  });

  it('shows plain-English reasons', async () => {
    await renderCompleted();
    const row = (name: string) => screen.getByText(name).closest('[data-testid="run-item-row"]') as HTMLElement;

    expect(within(row('Henry Clarke')).getByText('Already has a certificate')).toBeInTheDocument();
    expect(within(row('Leo Walker')).getByText('Course not completed')).toBeInTheDocument();
    expect(within(row('Isla Young')).getByText('Learner account inactive')).toBeInTheDocument();
    expect(within(row('Ava Thompson')).getByTestId('outcome-tag')).toHaveTextContent('Issued');
    expect(within(row('Leo Walker')).getByTestId('outcome-tag')).toHaveTextContent('Skipped');
    expect(within(row('Isla Young')).getByTestId('outcome-tag')).toHaveTextContent('Failed');
    expect(screen.getAllByText('Already has a certificate')).toHaveLength(3);
    expect(screen.getAllByText('Course not completed')).toHaveLength(4);
  });

  it('links issued and already-issued items to their certificate, and not-completed ones to nothing', async () => {
    await renderCompleted();
    const row = (name: string) => screen.getByText(name).closest('[data-testid="run-item-row"]') as HTMLElement;

    expect(within(row('Henry Clarke')).getByRole('link', { name: 'HHT-2026-000301' })).toHaveAttribute(
      'href',
      '/t/1/certificates/301',
    );
    expect(within(row('Ava Thompson')).getByRole('link', { name: 'HHT-2026-000501' })).toHaveAttribute(
      'href',
      '/t/1/certificates/501',
    );
    expect(within(row('Leo Walker')).queryByRole('link')).not.toBeInTheDocument();
    expect(within(row('Isla Young')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the revoked and internal-error reasons in plain English', async () => {
    mockSessionBackend('alice');
    const run = buildRun(16, DONE);
    run.items[0] = { ...run.items[0]!, outcome: 'skipped', reason: 'revoked', certificateId: 9, serial: 'HHT-2026-000009' };
    run.items[1] = { ...run.items[1]!, outcome: 'failed', reason: 'internal_error', certificateId: null, serial: null };
    server.use(http.get('/api/tenants/:tid/bulk-issue-runs/:runId', () => HttpResponse.json({ run })));
    renderAt(`/t/1/bulk-issue/runs/${DONE}`);

    expect(await screen.findByText('Certificate was revoked')).toBeInTheDocument();
    expect(screen.getByText('Unexpected error — try again')).toBeInTheDocument();
  });

  it('"Back to bulk issue" returns to the page with the course preselected', async () => {
    const { router } = await renderCompleted();

    await userEvent.click(screen.getByRole('button', { name: 'Back to bulk issue' }));

    expect(router.state.location.pathname + router.state.location.search).toBe('/t/1/bulk-issue?courseId=1');
    expect(await screen.findByRole('combobox', { name: 'Course' })).toBeInTheDocument();
  });

  it('keeps "Bulk issue" selected in the sidebar on the run page', async () => {
    await renderCompleted();
    expect(screen.getByRole('menuitem', { name: 'Bulk issue' })).toHaveClass('ant-menu-item-selected');
  });

  it('shows the Not found page for an unknown run', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend();
    renderAt('/t/1/bulk-issue/runs/12345');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('shows the Not found page for a malformed run id without calling the API', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend();
    renderAt('/t/1/bulk-issue/runs/abc');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(backend.gets).toHaveLength(0);
  });

  it('shows an error with Retry when the run fails to load', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend({ preloaded: { [DONE]: 16 } });
    let broken = true;
    server.use(
      http.get('/api/tenants/:tid/bulk-issue-runs/:runId', () =>
        broken
          ? HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Run unavailable' } }, { status: 500 })
          : undefined,
      ),
    );
    renderAt(`/t/1/bulk-issue/runs/${DONE}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Run unavailable');
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });
});

describe('bulk issue run page: progress', () => {
  it('polls a fresh mount of a running run until it completes at 16 / 16', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend({ preloaded: { [RUN_ID]: 3 } });
    renderAt(`/t/1/bulk-issue/runs/${RUN_ID}`);

    expect(await screen.findByText('Issuing…')).toBeInTheDocument();
    expect(progressText()).toMatch(/\d+ \/ 16/);

    await waitFor(() => expect(progressText()).toContain('16 / 16'), SLOW);
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(stat('Issued')).toBe('8');
    expect(stat('Skipped')).toBe('7');
    expect(stat('Failed')).toBe('1');

    // Polling stops once completed.
    const settled = backend.gets.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(backend.gets).toHaveLength(settled);
  });

  it('shows pending items as "Pending" with no reason while running, and progress that only moves forward', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend({ preloaded: { [RUN_ID]: 0 } });
    renderAt(`/t/1/bulk-issue/runs/${RUN_ID}`);

    expect(await screen.findByText('Issuing…')).toBeInTheDocument();
    const seen: number[] = [];
    await waitFor(() => {
      seen.push(Number(/(\d+) \/ 16/.exec(progressText())![1]));
      expect(seen.at(-1)).toBeGreaterThanOrEqual(4);
    }, SLOW);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(screen.getAllByTestId('outcome-tag').some((t) => t.textContent === 'Pending')).toBe(true);
  });

  it('keeps showing progress when one poll fails', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend({ preloaded: { [RUN_ID]: 2 } });
    let calls = 0;
    server.use(
      http.get('/api/tenants/:tid/bulk-issue-runs/:runId', () => {
        calls++;
        return calls === 2 ? HttpResponse.error() : undefined;
      }),
    );
    renderAt(`/t/1/bulk-issue/runs/${RUN_ID}`);

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(3), SLOW);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-progress')).toBeInTheDocument();
  });
});

describe('bulk issue: end to end in the UI', () => {
  it('issue -> run page -> completes, then the certificates list refetches', async () => {
    mockSessionBackend('alice');
    const certs = mockCertificatesBackend();
    mockBulkIssueBackend();
    const router = renderAt('/t/1/certificates');
    await screen.findAllByTestId('certificate-row');
    const before = certs.requests.length;

    await router.navigate('/t/1/bulk-issue?courseId=1');
    await userEvent.click(await screen.findByRole('button', { name: 'Issue 8 certificates' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Issue certificates' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/1/bulk-issue/runs/${RUN_ID}`));
    await screen.findByText('Completed', undefined, SLOW);
    expect(progressText()).toContain('16 / 16');

    await router.navigate('/t/1/certificates');
    await screen.findAllByTestId('certificate-row');
    await waitFor(() => expect(certs.requests.length).toBeGreaterThan(before));
  });
});
