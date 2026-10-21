import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QueryState } from './QueryState';

const base = { isPending: false, isError: false, error: null, onRetry: () => {} };

describe('QueryState', () => {
  it('shows an accessible loading indicator while pending', () => {
    render(
      <QueryState {...base} isPending>
        <p>content</p>
      </QueryState>,
    );

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('shows the error message and calls onRetry from the Retry button', async () => {
    const onRetry = vi.fn();
    render(
      <QueryState {...base} isError error={new Error('Server is down')} onRetry={onRetry}>
        <p>content</p>
      </QueryState>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Server is down');
    expect(screen.queryByText('content')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the empty node when the data set is empty', () => {
    render(
      <QueryState {...base} isEmpty empty={<p>Nothing here yet</p>}>
        <p>content</p>
      </QueryState>,
    );

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders children when there is data', () => {
    render(
      <QueryState {...base}>
        <p>content</p>
      </QueryState>,
    );

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
