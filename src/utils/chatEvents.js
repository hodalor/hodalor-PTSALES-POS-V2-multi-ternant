import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function tenantChannel(tenantId) {
  return `chat:${String(tenantId || 'master').trim().toLowerCase() || 'master'}`;
}

export function publishChatEvent(tenantId, payload) {
  emitter.emit(tenantChannel(tenantId), payload);
}

export function subscribeToChatEvents(tenantId, listener) {
  const channel = tenantChannel(tenantId);
  emitter.on(channel, listener);
  return () => emitter.off(channel, listener);
}
