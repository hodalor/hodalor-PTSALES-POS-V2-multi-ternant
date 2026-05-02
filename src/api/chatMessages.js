import { fetchJson, getApiBase } from './client';

export function listChatUsers() {
  return fetchJson('/api/chat-messages/users');
}

export function listConversation(userName, { limit } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchJson(`/api/chat-messages/conversation/${encodeURIComponent(String(userName || ''))}${qs ? `?${qs}` : ''}`);
}

export function listCallHistory(userName, { limit } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchJson(`/api/chat-messages/call-history/${encodeURIComponent(String(userName || ''))}${qs ? `?${qs}` : ''}`);
}

export function listIncomingCalls() {
  return fetchJson('/api/chat-messages/incoming-calls');
}

export function listPendingCallSignals(callId, { limit } = {}) {
  const params = new URLSearchParams();
  if (callId != null && String(callId || '').trim()) params.set('callId', String(callId || '').trim());
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchJson(`/api/chat-messages/call-signals/pending${qs ? `?${qs}` : ''}`);
}

export function sendChatMessage(payload) {
  return fetchJson('/api/chat-messages', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function markConversationRead(senderName) {
  return fetchJson('/api/chat-messages/mark-read', {
    method: 'POST',
    body: JSON.stringify({ senderName })
  });
}

export function reactToMessage(payload) {
  return fetchJson('/api/chat-messages/react', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function sendCallSignal(payload) {
  return fetchJson('/api/chat-messages/call-signal', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function createChatStream(onEvent) {
  return fetchJson('/api/chat-messages/stream-token', {
    method: 'POST',
    body: JSON.stringify({})
  }).then((payload) => {
    const streamToken = String(payload?.token || '').trim();
    if (!streamToken) throw new Error('Unable to start live chat stream');
    const tenantId = String(localStorage.getItem('ptSales:tenantId') || '').trim();
    const params = new URLSearchParams();
    params.set('streamToken', streamToken);
    if (tenantId) params.set('tenantId', tenantId);
    const url = `${getApiBase()}/api/chat-messages/stream?${params.toString()}`;
    const stream = new EventSource(url);
    stream.onmessage = (event) => {
      if (typeof onEvent !== 'function') return;
      try {
        const parsed = JSON.parse(String(event?.data || '{}'));
        onEvent(parsed);
      } catch {}
    };
    return stream;
  });
}
