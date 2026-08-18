import { Resend } from 'resend';
import { getConfig } from './config';

export type AuthEmailKind = 'verification' | 'password-reset';

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]!);
}

export function renderAuthEmail(kind: AuthEmailKind, input: { name: string; url: string }) {
  const name = escapeHtml(input.name.trim() || 'there');
  const url = escapeHtml(input.url);
  const verification = kind === 'verification';
  const subject = verification ? 'Verify your Storyloom email' : 'Reset your Storyloom password';
  const heading = verification ? 'Verify your email' : 'Reset your password';
  const intro = verification
    ? 'Confirm this address to finish creating your Storyloom studio.'
    : 'We received a request to choose a new password for your Storyloom account.';
  const button = verification ? 'Verify email' : 'Choose a new password';
  const expiry = verification ? 'This verification link expires in one hour.' : 'This reset link expires in one hour and can only be used once.';
  const text = `Hi ${input.name.trim() || 'there'},\n\n${intro}\n\n${button}: ${input.url}\n\n${expiry}\nIf you did not request this, you can safely ignore this email.\n\nStoryloom Studio`;
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f5f1ea;color:#26221d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(intro)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1ea;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fbf9f4;border:1px solid #ded7cd">
      <tr><td style="padding:28px 34px;border-bottom:1px solid #ded7cd;font-weight:700;color:#22352f">● &nbsp; Storyloom</td></tr>
      <tr><td style="padding:38px 34px">
        <p style="margin:0 0 14px;color:#bd5d36;font-size:11px;letter-spacing:2px;text-transform:uppercase">Account security</p>
        <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:38px;font-weight:400;line-height:1.05">${heading}</h1>
        <p style="margin:0 0 12px;line-height:1.7">Hi ${name},</p>
        <p style="margin:0 0 28px;line-height:1.7;color:#665e54">${escapeHtml(intro)}</p>
        <a href="${url}" style="display:inline-block;background:#22352f;color:#fff;text-decoration:none;padding:14px 20px;font-weight:600">${button} &nbsp;→</a>
        <p style="margin:28px 0 0;color:#80786e;font-size:13px;line-height:1.6">${expiry}<br>If you did not request this, you can safely ignore this email.</p>
      </td></tr>
      <tr><td style="padding:20px 34px;border-top:1px solid #ded7cd;color:#80786e;font-size:12px">Storyloom Studio · Your books, staged in time.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, html, text };
}

export async function sendAuthEmail(kind: AuthEmailKind, input: { to: string; name: string; url: string }) {
  const { auth } = getConfig();
  if (!auth.resendApiKey || !auth.emailFrom) {
    throw new Error('Transactional email is not configured. Set RESEND_API_KEY and STORYLOOM_EMAIL_FROM.');
  }
  const message = renderAuthEmail(kind, input);
  const { error } = await new Resend(auth.resendApiKey).emails.send({
    from: auth.emailFrom,
    to: [input.to],
    ...message
  });
  if (error) throw new Error(`Resend could not deliver the ${kind} email: ${error.message}`);
}
