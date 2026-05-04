import { fetchJson } from './client';

export function askPtAi(payload) {
  return fetchJson('/api/pt-ai/ask', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 15000
  });
}

export function transcribePtAi(payload) {
  return fetchJson('/api/pt-ai/transcribe', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 25000
  });
}

export function translatePtAi(payload) {
  return fetchJson('/api/pt-ai/translate', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 45000
  });
}
