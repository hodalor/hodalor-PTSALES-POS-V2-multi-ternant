export function sortByLatest(rows = [], picker) {
  return [...rows].sort((a, b) => {
    const aTs = new Date(typeof picker === 'function' ? picker(a) : a?.created_at || a?.createdAt || 0).getTime();
    const bTs = new Date(typeof picker === 'function' ? picker(b) : b?.created_at || b?.createdAt || 0).getTime();
    return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs);
  });
}
