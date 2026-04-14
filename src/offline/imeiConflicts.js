const KEY = 'ptsales:imei-conflicts:v1';

export function listImeiConflicts() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function write(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ items }));
  } catch {}
}

export function addImeiConflict(conflict) {
  const items = listImeiConflicts();
  const key = String(conflict?.queueId || `${Date.now()}`);
  const next = [{ id: key, createdAt: new Date().toISOString(), ...conflict }, ...items.filter(item => String(item.id) !== key)].slice(0, 500);
  write(next);
  return next;
}

export function removeImeiConflict(id) {
  const next = listImeiConflicts().filter(item => String(item.id) !== String(id));
  write(next);
  return next;
}

export function clearImeiConflicts() {
  write([]);
}
