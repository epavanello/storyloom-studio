import { describe, expect, it } from 'vitest';
import { renderAuthEmail } from './email';

describe('authentication email templates', () => {
  it.each([
    ['verification', 'Verify your Storyloom email', 'Verify email'],
    ['password-reset', 'Reset your Storyloom password', 'Choose a new password']
  ] as const)('renders the %s email in HTML and plain text', (kind, subject, action) => {
    const message = renderAuthEmail(kind, { name: 'Alex', url: 'https://storyloom.test/action?token=safe' });
    expect(message.subject).toBe(subject);
    expect(message.html).toContain(action);
    expect(message.html).toContain('https://storyloom.test/action?token=safe');
    expect(message.text).toContain(action);
    expect(message.text).toContain('expires in one hour');
  });

  it('escapes user-controlled names in HTML', () => {
    expect(renderAuthEmail('verification', { name: '<script>alert(1)</script>', url: 'https://storyloom.test' }).html)
      .not.toContain('<script>alert(1)</script>');
  });
});
