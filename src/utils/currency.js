export function formatCurrency(amount, settings) {
  const value = Number(amount) || 0;
  const symbol = settings?.currencySymbol || '₵';
  const position = settings?.currencyPosition || 'prefix';
  const fixed = value.toFixed(2);
  if (position === 'suffix') {
    return `${fixed}${symbol}`;
  }
  return `${symbol}${fixed}`;
}

