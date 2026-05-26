function resolveActiveCurrency(settings) {
  const currencies = Array.isArray(settings?.currencies) ? settings.currencies : [];
  const activeCode = String(settings?.activeCurrencyCode || settings?.currencyCode || '').trim().toUpperCase();
  const selected = currencies.find((entry) => String(entry?.code || '').trim().toUpperCase() === activeCode);
  return {
    symbol: String(selected?.symbol || settings?.currencySymbol || '₵'),
    position: String(selected?.position || settings?.currencyPosition || 'prefix') === 'suffix' ? 'suffix' : 'prefix'
  };
}

export function formatCurrency(amount, settings) {
  const value = Number(amount) || 0;
  const { symbol, position } = resolveActiveCurrency(settings);
  const fixed = value.toFixed(2);
  if (position === 'suffix') {
    return `${fixed}${symbol}`;
  }
  return `${symbol}${fixed}`;
}

