import { describe, expect, it } from 'vitest';
import { resolveTierPrice } from '../../src/utils/inventory.js';

describe('inventory price resolution', () => {
  it('uses warehouse price for warehouse tier before falling back to retail pricing', () => {
    expect(resolveTierPrice({
      retailPrice: 100,
      warehousePrice: 40
    }, 'warehouse', 100)).toBe(40);
  });

  it('falls back to the provided fallback when warehouse price is missing', () => {
    expect(resolveTierPrice({
      retailPrice: 100
    }, 'warehouse', 100)).toBe(100);
  });
});
