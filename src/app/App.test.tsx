import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('../legacy/ActivityPreview', () => ({
  default: ({ initialRoute }: { initialRoute: string }) => <main aria-label="React workspace application" data-route={initialRoute} />,
}));

describe('React application entry', () => {
  it('opens the shared workspace shell on Mission Control', () => {
    render(<App />);
    expect(screen.getByRole('main', { name: 'React workspace application' }).getAttribute('data-route')).toBe('overview');
  });
});
