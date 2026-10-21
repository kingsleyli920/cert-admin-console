import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockSessionBackend } from '../test/backend';
import { mockCertificatesBackend } from '../test/certificates';
import { renderAt } from '../test/render';

const EXPORT_PATH = '/api/tenants/1/certificates/export.csv';

/** The export is an antd Button rendered as a link; the status text is its only content. */
function exportLink(label: string | RegExp) {
  return screen.getByText(label).closest('a')!;
}

async function pick(selectName: string, optionTitle: string) {
  await userEvent.click(screen.getByRole('combobox', { name: selectName }));
  await userEvent.click(await screen.findByTitle(optionTitle));
}

describe('certificates page: CSV export button', () => {
  it('links to the export with the current filters and labels the filtered total', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend();
    renderAt('/t/1/certificates');

    const link = await screen.findByRole('link', { name: 'Export 25 rows' });
    expect(link).toHaveAttribute('href', EXPORT_PATH);
  });

  it('follows the search box after the debounce', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend();
    renderAt('/t/1/certificates');
    await screen.findByRole('link', { name: 'Export 25 rows' });

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search certificates' }), 'emma');

    const link = await screen.findByRole('link', { name: 'Export 1 row' });
    await waitFor(() => expect(link).toHaveAttribute('href', `${EXPORT_PATH}?q=emma`));
  });

  it('follows the status filter and never carries page or pageSize', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend();
    renderAt('/t/1/certificates?page=2&pageSize=50&sort=serial&order=asc');
    await screen.findByRole('link', { name: 'Export 25 rows' });

    await pick('Status', 'Revoked');

    const link = await screen.findByRole('link', { name: 'Export 4 rows' });
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe(EXPORT_PATH);
    expect(url.searchParams.get('status')).toBe('revoked');
    expect(url.searchParams.get('sort')).toBe('serial');
    expect(url.searchParams.get('order')).toBe('asc');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('pageSize')).toBe(false);
  });

  it('is disabled when the filters match no certificates', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend();
    renderAt('/t/1/certificates');
    await screen.findByRole('link', { name: 'Export 25 rows' });

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search certificates' }), 'zzzz');

    await screen.findByText('No certificates match your filters');
    const disabled = exportLink('Export 0 rows');
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled).not.toHaveAttribute('href');
  });

  it('is not rendered for a tenant with no certificates yet', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend();
    renderAt('/t/4/certificates');

    expect(await screen.findByText('No certificates yet')).toBeInTheDocument();
    expect(screen.queryByText(/^Export /)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Export/ })).not.toBeInTheDocument();
  });

  it('sits in the page header next to the total', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend();
    renderAt('/t/1/certificates');
    const link = await screen.findByRole('link', { name: 'Export 25 rows' });

    const header = screen.getByRole('heading', { name: 'Certificates' }).parentElement!;
    expect(within(header).getByText('25 certificates')).toBeInTheDocument();
    expect(header).toContainElement(link);
  });
});
