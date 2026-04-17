export async function sendMail({ to, subject, text, html }) {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
  const from = String(process.env.SMTP_FROM || user || '').trim();
  if (!host || !user || !pass || !from || !to) return { skipped: true };
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  await transporter.sendMail({ from, to, subject, text, html });
  return { ok: true };
}

export async function sendActivationCodeEmail({ to, tenantName, tenantId, activationCode, activationCodeExpiresAt, currencyCode, amount, months }) {
  if (!to) return { skipped: true };
  const expiryText = activationCodeExpiresAt ? new Date(activationCodeExpiresAt).toLocaleString() : 'Not set';
  const amountText = amount == null ? 'Not set' : `${Number(amount).toLocaleString()} ${currencyCode || ''}`.trim();
  const subject = `Subscription activation for ${tenantName || tenantId}`;
  const text = [
    `Tenant: ${tenantName || tenantId}`,
    `Tenant ID: ${tenantId}`,
    `Activation Code: ${activationCode}`,
    `Code Expires At: ${expiryText}`,
    `Renewal Amount: ${amountText}`,
    `Renewal Period: ${months ? `${months} month(s)` : 'N/A'}`
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
      <h2 style="margin:0 0 12px">Subscription Renewal</h2>
      <p><strong>Tenant:</strong> ${tenantName || tenantId}</p>
      <p><strong>Tenant ID:</strong> ${tenantId}</p>
      <p><strong>Activation Code:</strong> <span style="font-size:18px;letter-spacing:2px">${activationCode}</span></p>
      <p><strong>Code Expires At:</strong> ${expiryText}</p>
      <p><strong>Renewal Amount:</strong> ${amountText}</p>
      <p><strong>Renewal Period:</strong> ${months ? `${months} month(s)` : 'N/A'}</p>
    </div>`;
  return sendMail({ to, subject, text, html });
}
