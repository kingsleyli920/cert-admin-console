import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TzDate } from './TzDate';

const instant = '2026-04-04T14:30:00.000Z';

describe('TzDate', () => {
  it('formats the instant in Sydney during daylight saving time', () => {
    render(<TzDate utc={instant} timeZone="Australia/Sydney" />);
    expect(screen.getByText('5 Apr 2026, 1:30 am AEDT')).toBeInTheDocument();
  });

  it('formats the same instant in Perth on the previous calendar day', () => {
    render(<TzDate utc={instant} timeZone="Australia/Perth" />);
    expect(screen.getByText('4 Apr 2026, 10:30 pm AWST')).toBeInTheDocument();
  });

  it('shows the raw UTC instant in a tooltip on hover', async () => {
    render(<TzDate utc={instant} timeZone="Australia/Sydney" />);

    await userEvent.hover(screen.getByText('5 Apr 2026, 1:30 am AEDT'));

    expect(await screen.findByText('2026-04-04 14:30 UTC')).toBeInTheDocument();
  });
});
