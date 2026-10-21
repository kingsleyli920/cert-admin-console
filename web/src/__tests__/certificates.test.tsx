import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockSessionBackend } from '../test/backend';
import { mockCertificatesBackend } from '../test/certificates';
import { renderAt } from '../test/render';

async function rows() {
  return screen.findAllByTestId('certificate-row');
}

async function pick(selectName: string, optionTitle: string) {
  await userEvent.click(screen.getByRole('combobox', { name: selectName }));
  await userEvent.click(await screen.findByTitle(optionTitle));
}

function lastRequest(backend: { requests: URLSearchParams[] }) {
  return backend.requests[backend.requests.length - 1]!;
}

describe('certificates page: data states', () => {
  it('shows a loading state, then the first page of rows and the total', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend({ delayMs: { 1: 100 } });
    renderAt('/t/1/certificates');

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await rows()).toHaveLength(20);
    expect(screen.getByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(screen.getByText('25 certificates')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });

  it('renders serial links to the detail route and a status tag with text', async () => {
    mockSessionBackend('alice');
    renderAt('/t/1/certificates');

    const [first] = await rows();
    expect(within(first!).getByRole('link', { name: 'HHT-2026-000100' })).toHaveAttribute(
      'href',
      '/t/1/certificates/100',
    );
    expect(within(first!).getByTestId('status-tag')).toHaveTextContent('Valid');
    expect(screen.getAllByTestId('status-tag').some((t) => t.textContent === 'Revoked')).toBe(true);
  });

  it('shows the DST-edge issue time in the tenant timezone (HHT Sydney, SRA Perth)', async () => {
    mockSessionBackend('alice');
    renderAt('/t/1/certificates');
    const [hhtRow] = await rows();
    expect(within(hhtRow!).getByText('5 Apr 2026, 1:30 am AEDT')).toBeInTheDocument();
  });

  it('shows the same instant as the previous evening in SRA (Perth)', async () => {
    mockSessionBackend('alice');
    renderAt('/t/2/certificates');
    const [sraRow] = await rows();
    expect(within(sraRow!).getByText('4 Apr 2026, 10:30 pm AWST')).toBeInTheDocument();
    expect(within(sraRow!).getByText('Emma Wilson')).toBeInTheDocument();
  });

  it('shows an error with Retry that recovers once the server is back', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    backend.failWith = 'Database unavailable';
    renderAt('/t/1/certificates');

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    expect(screen.queryByTestId('certificate-row')).not.toBeInTheDocument();

    backend.failWith = undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await rows()).toHaveLength(20);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('NHI has no certificates: shows the "no certificates yet" state with a bulk-issue button', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/4/certificates');

    expect(await screen.findByText('No certificates yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/match your filters/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Bulk issue certificates' }));

    expect(router.state.location.pathname).toBe('/t/4/bulk-issue');
  });
});

describe('certificates page: filters, sorting and paging', () => {
  it('a search with no hits shows "No certificates match your filters"; Clear filters restores rows', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/1/certificates?sort=serial&order=asc');
    await rows();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search certificates' }), 'zzzz');

    expect(await screen.findByText('No certificates match your filters')).toBeInTheDocument();
    expect(screen.queryByText('No certificates yet')).not.toBeInTheDocument();
    expect(router.state.location.search).toContain('q=zzzz');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await rows()).toHaveLength(20);
    expect(screen.getByRole('searchbox', { name: 'Search certificates' })).toHaveValue('');
    expect(router.state.location.search).toBe('?sort=serial&order=asc');
  });

  it('typing in the search box sends one request after the 300 ms debounce', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    renderAt('/t/1/certificates');
    await rows();
    const before = backend.requests.length;

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search certificates' }), 'emma');
    expect(backend.requests).toHaveLength(before); // nothing sent while typing

    await waitFor(() => expect(lastRequest(backend).get('q')).toBe('emma'));
    expect(backend.requests).toHaveLength(before + 1);
    expect(await screen.findAllByTestId('certificate-row')).toHaveLength(1);
    expect(screen.getByText('1 certificate')).toBeInTheDocument();
  });

  it('clicking the Learner header sorts ascending, then descending', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    renderAt('/t/1/certificates');
    await rows();
    const header = screen.getByRole('columnheader', { name: /Learner/ });

    await userEvent.click(header);
    await waitFor(() => expect(lastRequest(backend).get('sort')).toBe('learnerName'));
    expect(lastRequest(backend).get('order')).toBe('asc');
    await waitFor(async () => expect((await rows())[0]).toHaveTextContent('Archie King'));

    await userEvent.click(header);
    await waitFor(() => expect(lastRequest(backend).get('order')).toBe('desc'));
    expect(lastRequest(backend).get('sort')).toBe('learnerName');
    await waitFor(async () => expect((await rows())[0]).toHaveTextContent('Zoe Martin'));
  });

  it('changing page sends page=2 and shows the remaining rows', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    const router = renderAt('/t/1/certificates');
    await rows();

    await userEvent.click(screen.getByTitle('2'));

    await waitFor(() => expect(lastRequest(backend).get('page')).toBe('2'));
    expect(router.state.location.search).toBe('?page=2');
    await waitFor(async () => expect(await rows()).toHaveLength(5));
  });

  it('selecting a course and a status sends courseId and status', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    renderAt('/t/1/certificates');
    await rows();

    await pick('Course', 'Fire Safety 2026');
    await waitFor(() => expect(lastRequest(backend).get('courseId')).toBe('1'));

    await pick('Status', 'Revoked');
    await waitFor(() => expect(lastRequest(backend).get('status')).toBe('revoked'));
    expect(lastRequest(backend).get('courseId')).toBe('1');
    for (const status of screen.getAllByTestId('status-tag')) {
      expect(status).toHaveTextContent('Revoked');
    }
  });

  it('changing the page size resets to page 1 and sends pageSize', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    renderAt('/t/1/certificates?page=2');
    await rows();

    await userEvent.click(screen.getByTitle('20 / page'));
    await userEvent.click(await screen.findByTitle('50 / page'));

    await waitFor(() => expect(lastRequest(backend).get('pageSize')).toBe('50'));
    expect(lastRequest(backend).get('page')).toBe('1');
    expect(await rows()).toHaveLength(25);
  });

  it('populates the controls and the request from the URL on load', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    renderAt('/t/1/certificates?q=emma&status=revoked&page=2');

    await screen.findByText('No certificates match your filters');
    expect(screen.getByRole('searchbox', { name: 'Search certificates' })).toHaveValue('emma');
    expect(screen.getByRole('combobox', { name: 'Status' }).closest('.ant-select')).toHaveTextContent(
      'Revoked',
    );
    const req = backend.requests[0]!;
    expect(req.get('q')).toBe('emma');
    expect(req.get('status')).toBe('revoked');
    expect(req.get('page')).toBe('2');
  });

  it('falls back to defaults for invalid URL values', async () => {
    mockSessionBackend('alice');
    const backend = mockCertificatesBackend();
    renderAt('/t/1/certificates?sort=bogus&page=0&pageSize=500');

    expect(await rows()).toHaveLength(20);
    const req = backend.requests[0]!;
    expect(req.get('sort')).toBe('issuedAt');
    expect(req.get('page')).toBe('1');
    expect(req.get('pageSize')).toBe('20');
  });
});

describe('certificates page: tenant isolation', () => {
  it('switching HHT to SRA never shows HHT rows under SRA', async () => {
    mockSessionBackend('alice');
    mockCertificatesBackend({ delayMs: { 2: 300 } });
    renderAt('/t/1/certificates');
    await rows();
    expect(screen.getByText('HHT-2026-000100')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Tenant' }));
    await userEvent.click(await screen.findByTitle('Swan River Academy'));

    expect(await screen.findByText('Australia/Perth')).toBeInTheDocument();
    expect(screen.queryByText(/^HHT-/)).not.toBeInTheDocument(); // SRA is still loading
    expect(screen.queryByText('25 certificates')).not.toBeInTheDocument();

    expect(await rows()).toHaveLength(5);
    expect(screen.queryByText(/^HHT-/)).not.toBeInTheDocument();
    expect(screen.getByText('5 certificates')).toBeInTheDocument();
  });
});
