import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { mockSessionBackend } from '../test/backend';
import { fireSafety, mockBulkIssueBackend, RUN_ID } from '../test/bulkIssue';
import { server } from '../test/msw';
import { renderAt } from '../test/render';

// Poll fast so a 16-item run (one item per GET) finishes within a test.
vi.mock('../pages/bulk-issue/constants', () => ({ RUN_POLL_MS: 20 }));

const issueButton = (n = 8) => screen.findByRole('button', { name: `Issue ${n} certificates` });
// antd's test-env ids collide, so the dialog's accessible name is unreliable; match by role + title.
const dialog = async (course = 'Fire Safety 2026') => {
  const dlg = await screen.findByRole('dialog');
  expect(within(dlg).getByText(`Issue certificates for ${course}?`)).toBeInTheDocument();
  return dlg;
};
const okButton = async () => within(await dialog()).getByRole('button', { name: 'Issue certificates' });
// jsdom never fires the close animation's end event, so a closed antd modal stays mounted
// while it plays its "leave" motion; that is the observable "closed" state here.
const closed = (dlg: HTMLElement) =>
  waitFor(() => expect(dlg.className).toMatch(/ant-zoom-leave|ant-zoom-appear-prepare/), { timeout: 4000 });
const SLOW = { timeout: 4000 };

async function pick(selectName: string, optionTitle: string) {
  await userEvent.click(screen.getByRole('combobox', { name: selectName }));
  await userEvent.click(await screen.findByTitle(optionTitle));
}

async function openConfirm() {
  await userEvent.click(await issueButton());
  return okButton();
}

describe('bulk issue page', () => {
  it('shows the distribution for the course from ?courseId and the issue button', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend();
    renderAt('/t/1/bulk-issue?courseId=1');

    expect(await issueButton()).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Bulk issue' })).toBeInTheDocument();
    expect(screen.getByText('16 enrolled')).toBeInTheDocument();
    const expected = { Eligible: '8', 'Already issued': '3', 'Not completed': '4', Inactive: '1' };
    for (const [title, value] of Object.entries(expected)) {
      const stat = screen.getByText(title).closest('.ant-statistic') as HTMLElement;
      expect(within(stat).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Course' })).toBeInTheDocument();
  });

  it('asks for a course first and shows the counts after picking one', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend();
    renderAt('/t/1/bulk-issue');

    expect(await screen.findByText(/Select a course to see/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Issue \d+ certificate/ })).not.toBeInTheDocument();

    await pick('Course', 'Fire Safety 2026');

    expect(await issueButton()).toBeEnabled();
  });

  it('works for a tenant with a different timezone and course list (NHI)', async () => {
    mockSessionBackend('alice');
    renderAt('/t/4/bulk-issue?courseId=6');

    expect(await issueButton(5)).toBeInTheDocument();
    expect(screen.getByText('20 enrolled')).toBeInTheDocument();
  });

  it('disables the button and explains why when nobody is eligible', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend({
      courses: [{ ...fireSafety, counts: { eligible: 0, alreadyIssued: 12, notCompleted: 3, inactive: 1 } }],
    });
    renderAt('/t/1/bulk-issue?courseId=1');

    expect(await issueButton(0)).toBeDisabled();
    expect(
      screen.getByText('Every enrolled learner already has a certificate or is not eligible.'),
    ).toBeInTheDocument();
  });

  it('shows an empty state when the tenant has no courses', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend({ courses: [] });
    renderAt('/t/1/bulk-issue');

    expect(await screen.findByText('No courses yet')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Course' })).not.toBeInTheDocument();
  });

  it('shows an error with Retry when courses fail to load', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend();
    let broken = true;
    server.use(
      http.get('/api/tenants/:tid/courses', () =>
        broken
          ? HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Courses unavailable' } }, { status: 500 })
          : HttpResponse.json({ items: [fireSafety] }),
      ),
    );
    renderAt('/t/1/bulk-issue?courseId=1');

    expect(await screen.findByRole('alert')).toHaveTextContent('Courses unavailable');
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await issueButton()).toBeInTheDocument();
  });
});

describe('bulk issue: confirm and submit', () => {
  it('summarises what will happen in the confirm dialog and sends nothing on Cancel', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend();
    renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.click(await issueButton());
    const dlg = await dialog();

    expect(within(dlg).getByText('8 certificates will be issued.')).toBeInTheDocument();
    expect(within(dlg).getByText('3 already have a certificate and will be skipped.')).toBeInTheDocument();
    expect(within(dlg).getByText('4 have not completed the course and will be skipped.')).toBeInTheDocument();
    expect(within(dlg).getByText('1 inactive learner(s) will be reported as failed.')).toBeInTheDocument();

    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await closed(dlg);
    expect(backend.posts).toHaveLength(0);
  });

  it('sends exactly one POST with an Idempotency-Key UUID on a double click of OK', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend({ postDelayMs: 100 });
    const router = renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.dblClick(await openConfirm());

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/1/bulk-issue/runs/${RUN_ID}`));
    expect(backend.posts).toHaveLength(1);
    expect(backend.posts[0]).toMatchObject({ tid: 1, courseId: 1 });
    expect(backend.posts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows the page button as loading and the dialog busy while the POST is pending', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend({ postDelayMs: 300 });
    renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.click(await openConfirm());

    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Issue certificates/ })).toHaveClass('ant-btn-loading');
  });

  it('retries a network failure with the SAME key, then lands on the run page', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend({ post: ['network-error'] });
    const router = renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.click(await openConfirm());

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/1/bulk-issue/runs/${RUN_ID}`), SLOW);
    expect(backend.posts).toHaveLength(2);
    expect(backend.posts[0]!.key).toBeTruthy();
    expect(backend.posts[1]!.key).toBe(backend.posts[0]!.key);
    expect(await screen.findByRole('heading', { name: 'Fire Safety 2026' })).toBeInTheDocument();
  });

  it('stops after 2 retries when the network stays down and shows an error', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend({ post: ['network-error', 'network-error', 'network-error', 'network-error'] });
    const router = renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.click(await openConfirm());
    const dlg = await dialog();

    await waitFor(() => expect(backend.posts).toHaveLength(3), SLOW);
    await closed(dlg);
    expect(new Set(backend.posts.map((p) => p.key)).size).toBe(1);
    expect(router.state.location.pathname).toBe('/t/1/bulk-issue');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows the server message on a 422 and stays on the page without retrying', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend({
      post: [{ status: 422, code: 'IDEMPOTENCY_KEY_REUSED', message: 'Key was used for another course' }],
    });
    const router = renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.click(await openConfirm());
    const dlg = await dialog();

    expect(await screen.findByText('Key was used for another course')).toBeInTheDocument();
    await closed(dlg);
    expect(router.state.location.pathname).toBe('/t/1/bulk-issue');
    expect(backend.posts).toHaveLength(1);
    expect(await issueButton()).toBeEnabled();
  });

  it('shows the server message on a 400', async () => {
    mockSessionBackend('alice');
    mockBulkIssueBackend({
      post: [{ status: 400, code: 'VALIDATION_ERROR', message: 'Idempotency-Key must be a UUID' }],
    });
    renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.click(await openConfirm());

    expect(await screen.findByText('Idempotency-Key must be a UUID')).toBeInTheDocument();
  });

  it('keeps the key when retrying the same course after an error, and renews it for another course', async () => {
    mockSessionBackend('alice');
    const backend = mockBulkIssueBackend({
      courses: [fireSafety, { ...fireSafety, id: 2, title: 'First Aid Essentials' }],
      post: [
        { status: 500, code: 'INTERNAL_ERROR', message: 'Boom' },
        { status: 500, code: 'INTERNAL_ERROR', message: 'Boom' },
      ],
    });
    renderAt('/t/1/bulk-issue?courseId=1');

    await userEvent.click(await openConfirm());
    await screen.findByText('Boom');
    await userEvent.click(await openConfirm());
    await waitFor(() => expect(backend.posts).toHaveLength(2));

    await pick('Course', 'First Aid Essentials');
    await userEvent.click(await issueButton());
    await userEvent.click(
      within(await dialog('First Aid Essentials')).getByRole('button', { name: 'Issue certificates' }),
    );

    await waitFor(() => expect(backend.posts).toHaveLength(3));
    expect(backend.posts[1]!.key).toBe(backend.posts[0]!.key);
    expect(backend.posts[2]!.key).not.toBe(backend.posts[0]!.key);
    expect(backend.posts[2]!.courseId).toBe(2);
  });
});
