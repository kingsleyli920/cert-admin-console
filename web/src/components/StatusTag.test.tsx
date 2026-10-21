import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusTag } from './StatusTag';

describe('StatusTag', () => {
  it('renders a green "Valid" tag', () => {
    render(<StatusTag status="valid" />);
    const tag = screen.getByTestId('status-tag');
    expect(tag).toHaveTextContent('Valid');
    expect(tag).toHaveClass('ant-tag-green');
  });

  it('renders a red "Revoked" tag', () => {
    render(<StatusTag status="revoked" />);
    const tag = screen.getByTestId('status-tag');
    expect(tag).toHaveTextContent('Revoked');
    expect(tag).toHaveClass('ant-tag-red');
  });
});
