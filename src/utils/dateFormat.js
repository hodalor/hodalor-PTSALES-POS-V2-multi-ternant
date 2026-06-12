function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, fallback = '—') {
  const date = toDate(value);
  if (!date) return fallback;
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatTime(value, fallback = '') {
  const date = toDate(value);
  if (!date) return fallback;
  const hours = date.getHours();
  const normalizedHours = hours % 12 || 12;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${normalizedHours}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${suffix}`;
}

export function formatDateTime(value, fallback = '—') {
  const date = toDate(value);
  if (!date) return fallback;
  return `${formatDate(date, fallback)} ${formatTime(date, '')}`.trim();
}
