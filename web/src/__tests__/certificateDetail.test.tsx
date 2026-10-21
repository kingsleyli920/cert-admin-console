import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockSessionBackend } from '../test/backend';
import { mockCertificatesBackend } from '../test/certificates';
import { mockDetailBackend } from '../test/certificateDetail';
import { renderAt } from '../test/render';

/** Queries scoped to the value cell next to a Descriptions label. */
const valueOf = async (label: string) => {
  const th = (await screen.findByText(label, { selector: 'th span' })).closest('th')!;
  return within(th.nextElementSibling as HTMLElement);
};
const auditEntries = async () => screen.findAllByTestId('audit-entry');

describe('certificate detail page: content', () => {
  it('shows the serial with a status tag and every field of a valid certificate (HHT, Sydney)', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/100');

    expect(await screen.findByRole('heading', { level: 2, name: /HHT-2026-000100/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('status-tag')[0]).toHaveTextContent('Valid');

    expect((await valueOf('Serial number')).getByText('HHT-2026-000100')).toBeInTheDocument();
    expect((await valueOf('Learner')).getByText('Emma Wilson')).toBeInTheDocument();
    expect((await valueOf('Course')).getByText('Fire Safety 2026')).toBeInTheDocument();
    const issued = await valueOf('Issued');
    expect(issued.getByText('5 Apr 2026, 1:30 am AEDT')).toBeInTheDocument();
    expect(issued.getByText('Australia/Sydney')).toBeInTheDocument();
    expect((await valueOf('Issued by')).getByText('Alice Nguyen')).toBeInTheDocument();
    expect((await valueOf('Status')).getByText('Valid')).toBeInTheDocument();
    expect(screen.queryByText('Revoked by', { selector: 'th span' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke certificate' })).toBeInTheDocument();
  });

  it('shows the same UTC instant as the previous evening for SRA (Perth)', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/2/certificates/200');

    const issued = await valueOf('Issued');
    expect(issued.getByText('4 Apr 2026, 10:30 pm AWST')).toBeInTheDocument();
    expect(issued.getByText('Australia/Perth')).toBeInTheDocument();
  });

  it('puts the UTC instant in the issue time tooltip', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/100');

    const time = (await (await valueOf('Issued')).findByText('5 Apr 2026, 1:30 am AEDT')) as HTMLElement;
    expect(time).toHaveAttribute('datetime', '2026-04-04T14:30:00.000Z');
    await userEvent.hover(time);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('2026-04-04 14:30 UTC');
  });

  it('shows revoke info and no revoke button for a revoked certificate', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/101');

    expect(await screen.findByRole('heading', { level: 2, name: /HHT-2026-000101/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('status-tag')[0]).toHaveTextContent('Revoked');
    expect((await valueOf('Revoked')).getByText('6 Apr 2026, 12:15 pm AEST')).toBeInTheDocument();
    expect((await valueOf('Revoked by')).getByText('Carol Smith')).toBeInTheDocument();
    expect((await valueOf('Reason')).getByText('Issued to the wrong learner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke certificate' })).not.toBeInTheDocument();
  });

  it('lists the audit trail oldest first with both actors and a link to the bulk issue run', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/101');

    expect(await screen.findByRole('heading', { level: 3, name: 'Audit trail' })).toBeInTheDocument();
    const [issue, revoke] = await auditEntries();
    expect(issue).toHaveTextContent('Issued by Alice Nguyen');
    expect(issue).toHaveTextContent('5 Apr 2026, 1:30 am AEDT');
    expect(within(issue!).getByRole('link', { name: 'bulk issue run' })).toHaveAttribute(
      'href',
      '/t/1/bulk-issue/runs/77',
    );
    expect(revoke).toHaveTextContent('Revoked by Carol Smith');
    expect(revoke).toHaveTextContent('6 Apr 2026, 12:15 pm AEST');
    expect(within(revoke!).queryByRole('link')).not.toBeInTheDocument();
    expect(await auditEntries()).toHaveLength(2);
  });

  it('keeps "Certificates" selected in the side navigation', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/100');

    await screen.findByRole('heading', { level: 2, name: /HHT-2026-000100/ });
    const item = screen.getByRole('menuitem', { name: 'Certificates' });
    expect(item).toHaveClass('ant-menu-item-selected');
  });
});

describe('certificate detail page: states and navigation', () => {
  it('shows a loading state first', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/100');

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    await screen.findByRole('heading', { level: 2, name: /HHT-2026-000100/ });
  });

  it.each([
    ['another tenant\'s certificate (200 exists only in SRA)', '/t/1/certificates/200'],
    ['an unknown id', '/t/1/certificates/9999'],
    ['a non-numeric id', '/t/1/certificates/abc'],
  ])('shows the not-found page for %s', async (_name, path) => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt(path);

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByTestId('status-tag')).not.toBeInTheDocument();
  });

  it('shows the server message and a working Retry on a 500', async () => {
    mockSessionBackend('alice');
    const backend = mockDetailBackend();
    backend.failDetail = 'Database unavailable';
    renderAt('/t/1/certificates/100');

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    backend.failDetail = undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { level: 2, name: /HHT-2026-000100/ })).toBeInTheDocument();
  });

  it('opens from a list row and the back link returns to the list with its query string', async () => {
    mockSessionBackend('alice');
    const list = mockCertificatesBackend();
    mockDetailBackend();
    const router = renderAt('/t/1/certificates?q=emma');

    await userEvent.click(await screen.findByRole('link', { name: 'HHT-2026-000100' }));
    expect(await screen.findByRole('heading', { level: 2, name: /HHT-2026-000100/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/1/certificates/100');

    await userEvent.click(screen.getByRole('link', { name: '← Certificates' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/t/1/certificates'));
    expect(router.state.location.search).toBe('?q=emma');
    await waitFor(() => expect(list.requests.at(-1)?.get('q')).toBe('emma'));
  });

  it('links back to the plain list when opened directly', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/100');

    await screen.findByRole('heading', { level: 2, name: /HHT-2026-000100/ });
    expect(screen.getByRole('link', { name: '← Certificates' })).toHaveAttribute('href', '/t/1/certificates');
  });
});

describe('certificate detail page: revoke dialog', () => {
  // antd's test-env ids collide, so the dialog's accessible name is unreliable; match by role + title.
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke certificate' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Revoke certificate HHT-2026-000100?')).toBeInTheDocument();
    return dlg;
  };
  const reasonBox = (dlg: HTMLElement) => within(dlg).getByRole('textbox', { name: 'Reason' });
  // While pending antd prefixes the name with its loading icon ("loading Revoke").
  const submit = (dlg: HTMLElement) => within(dlg).getByRole('button', { name: /Revoke$/ });
  // jsdom never fires the close animation's end event, so a closed antd modal stays mounted
  // while it plays its "leave" motion; that is the observable "closed" state here.
  const closed = (dlg: HTMLElement) =>
    waitFor(() => expect(dlg.className).toMatch(/ant-zoom-leave|ant-zoom-appear-prepare/), { timeout: 4000 });
  const SLOW = { timeout: 4000 };

  it.each([['empty', ''], ['whitespace-only', '   \n ']])(
    'blocks an %s reason with a validation message and sends nothing',
    async (_name, text) => {
      mockSessionBackend('alice');
      const backend = mockDetailBackend();
      renderAt('/t/1/certificates/100');
      const dlg = await openDialog();

      if (text) await userEvent.type(reasonBox(dlg), text);
      await userEvent.click(submit(dlg));

      expect(await within(dlg).findByText('Enter a reason for revoking this certificate')).toBeInTheDocument();
      expect(backend.revokes).toEqual([]);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    },
  );

  it('limits the reason to 500 characters and shows a counter', async () => {
    mockSessionBackend('alice');
    mockDetailBackend();
    renderAt('/t/1/certificates/100');
    const dlg = await openDialog();

    expect(reasonBox(dlg)).toHaveAttribute('maxlength', '500');
    expect(within(dlg).getByText('0 / 500')).toBeInTheDocument();
  });

  it('sends the trimmed reason once, then shows Revoked, the new audit entry and no button', async () => {
    mockSessionBackend('alice');
    const backend = mockDetailBackend();
    renderAt('/t/1/certificates/100');
    const dlg = await openDialog();

    await userEvent.type(reasonBox(dlg), '  Issued in error  ');
    await userEvent.click(submit(dlg));

    expect(await screen.findByText('Certificate revoked')).toBeInTheDocument();
    expect(backend.revokes).toEqual([{ reason: 'Issued in error' }]);
    await closed(dlg);
    expect(screen.getAllByTestId('status-tag')[0]).toHaveTextContent('Revoked');
    expect((await valueOf('Revoked by')).getByText('Alice Nguyen')).toBeInTheDocument();
    expect((await valueOf('Reason')).getByText('Issued in error')).toBeInTheDocument();
    expect(await auditEntries()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Revoke certificate' })).not.toBeInTheDocument();
    // The returned detail is put into the cache; no extra GET is needed.
    expect(backend.detailRequests).toBe(1);
  });

  it('sends one request on a double click and keeps the dialog busy meanwhile', async () => {
    mockSessionBackend('alice');
    const backend = mockDetailBackend({ revokeDelayMs: 150 });
    renderAt('/t/1/certificates/100');
    const dlg = await openDialog();

    await userEvent.type(reasonBox(dlg), 'Duplicate');
    await userEvent.dblClick(submit(dlg));

    await waitFor(() => expect(submit(dlg).closest('button')).toHaveClass('ant-btn-loading'));
    await screen.findByText('Certificate revoked', {}, SLOW);
    expect(backend.revokes).toHaveLength(1);
  });

  it('refetches the certificate list after a revoke', async () => {
    mockSessionBackend('alice');
    const list = mockCertificatesBackend();
    mockDetailBackend();
    const router = renderAt('/t/1/certificates');
    await userEvent.click(await screen.findByRole('link', { name: 'HHT-2026-000100' }));
    const dlg = await openDialog();
    const before = list.requests.length;

    await userEvent.type(reasonBox(dlg), 'Wrong learner');
    await userEvent.click(submit(dlg));
    await screen.findByText('Certificate revoked');
    await userEvent.click(screen.getByRole('link', { name: '← Certificates' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/t/1/certificates'));
    await waitFor(() => expect(list.requests.length).toBeGreaterThan(before));
  });

  it('warns on 409, refetches the detail and shows the other admin\'s revoke', async () => {
    mockSessionBackend('alice');
    const backend = mockDetailBackend();
    backend.revokeElsewhere = true;
    renderAt('/t/1/certificates/100');
    const dlg = await openDialog();

    await userEvent.type(reasonBox(dlg), 'Mine too');
    await userEvent.click(submit(dlg));

    expect(await screen.findByText('This certificate was already revoked')).toBeInTheDocument();
    await waitFor(() => expect(backend.detailRequests).toBe(2));
    expect((await valueOf('Revoked by')).getByText('Carol Smith')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke certificate' })).not.toBeInTheDocument();
    await closed(dlg);
  });

  it('shows the server message on a 500 and keeps the dialog and the typed reason', async () => {
    mockSessionBackend('alice');
    const backend = mockDetailBackend();
    backend.failRevoke = { status: 500, code: 'INTERNAL_ERROR', message: 'Database is locked' };
    renderAt('/t/1/certificates/100');
    const dlg = await openDialog();

    await userEvent.type(reasonBox(dlg), 'Retry me');
    await userEvent.click(submit(dlg));

    expect(await screen.findByText('Database is locked')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBe(dlg);
    expect(reasonBox(dlg)).toHaveValue('Retry me');
    await waitFor(() => expect(submit(dlg).closest('button')).toBeEnabled());
    expect(screen.getAllByTestId('status-tag')[0]).toHaveTextContent('Valid');

    // The server recovers: the same dialog can be submitted again.
    backend.failRevoke = undefined;
    await userEvent.click(submit(dlg));
    expect(await screen.findByText('Certificate revoked')).toBeInTheDocument();
    expect(backend.revokes).toHaveLength(2);
  });

  it('cancel closes the dialog without a request and a reopened dialog starts empty', async () => {
    mockSessionBackend('alice');
    const backend = mockDetailBackend();
    renderAt('/t/1/certificates/100');
    const dlg = await openDialog();

    await userEvent.type(reasonBox(dlg), 'Changed my mind');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await closed(dlg);

    await userEvent.click(screen.getByRole('button', { name: 'Revoke certificate' }));
    const reopened = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(reasonBox(reopened)).toHaveValue('');
    expect(backend.revokes).toEqual([]);
  });
});
