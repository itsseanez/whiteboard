// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from './Button';
import Field from './Field';

afterEach(cleanup);

describe('Field', () => {
  it('is found by its label and reports typed text', () => {
    const onChange = vi.fn();
    render(<Field label="Email" value="" onChange={onChange} type="email" />);

    const input = screen.getByLabelText('Email');
    fireEvent.change(input, { target: { value: 'a@b.co' } });

    expect(onChange).toHaveBeenCalledWith('a@b.co');
    expect(input.getAttribute('type')).toBe('email');
  });

  it('gives two fields with the same label different ids', () => {
    render(
      <>
        <Field label="Name" value="" onChange={() => {}} />
        <Field label="Name" value="" onChange={() => {}} />
      </>,
    );
    const [a, b] = screen.getAllByLabelText('Name');
    expect(a!.id).not.toBe(b!.id);
  });

  it('links its hint to the input for screen readers', () => {
    render(<Field label="Password" value="" onChange={() => {}} hint="At least 8 characters." />);
    const input = screen.getByLabelText('Password');
    const hint = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('At least 8 characters.');
  });
});

describe('Button', () => {
  it('does not submit the surrounding form unless asked to', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
        <Button type="submit">Send</Button>
      </form>,
    );

    fireEvent.click(screen.getByText('Plain'));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Send'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks while disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
