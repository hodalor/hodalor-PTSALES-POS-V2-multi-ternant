export function safeErrorStatus(err, fallback = 500) {
  const status = Number(err?.status || err?.statusCode || fallback);
  return Number.isFinite(status) && status >= 400 && status < 600 ? status : fallback;
}

function looksInternal(message = '') {
  const lower = String(message || '').toLowerCase();
  return (
    lower.includes('getaddrinfo') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('mongodb') ||
    lower.includes('mongo') ||
    lower.includes('srv') ||
    lower.includes('server selection') ||
    lower.includes('topology') ||
    lower.includes('stack') ||
    lower.includes('localhost:') ||
    lower.includes('.mongodb.net')
  );
}

export function safeErrorMessage(err, fallback = 'Request failed') {
  const raw = String(err?.message || '').trim();
  const status = safeErrorStatus(err, 500);
  if (status >= 400 && status < 500 && raw && !looksInternal(raw)) return raw;
  return fallback;
}
