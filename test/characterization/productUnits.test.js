import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  productFindOne: vi.fn(),
  productUnitFind: vi.fn(),
  productUnitFindOne: vi.fn(),
  productUnitFindOneAndUpdate: vi.fn(),
  branchFindOne: vi.fn()
}));

vi.mock('../../src/models/Product.js', () => ({
  default: {
    findOne: mocks.productFindOne
  }
}));

vi.mock('../../src/models/ProductUnit.js', () => ({
  default: {
    find: mocks.productUnitFind,
    findOne: mocks.productUnitFindOne,
    findOneAndUpdate: mocks.productUnitFindOneAndUpdate
  }
}));

vi.mock('../../src/models/Branch.js', () => ({
  default: {
    findOne: mocks.branchFindOne
  }
}));

vi.mock('../../src/utils/inventory.js', () => ({
  getMapQty: vi.fn(),
  getStockTarget: vi.fn(),
  markInventoryModified: vi.fn(),
  setMapQty: vi.fn()
}));

const productUnits = await import('../../src/utils/productUnits.js');

describe('productUnits characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes track and inventory types to current defaults', () => {
    expect(productUnits.normalizeTrackType('serialized')).toBe('serialized');
    expect(productUnits.normalizeTrackType('anything-else')).toBe('quantity');
    expect(productUnits.normalizeInventoryType('warehouse')).toBe('warehouse');
    expect(productUnits.normalizeInventoryType('unexpected')).toBe('retail');
  });

  it('parses serialized entries from newline-delimited mixed separators', () => {
    expect(productUnits.parseSerializedEntries('12345,ABC\n777\tSER-777\nONLYONE')).toEqual([
      { imei: '12345', serialNumber: 'ABC' },
      { imei: '777', serialNumber: 'SER-777' },
      { imei: 'ONLYONE', serialNumber: 'ONLYONE' }
    ]);
  });

  it('normalizes serialized entries by trimming fields and filling missing serial numbers', () => {
    expect(productUnits.normalizeSerializedEntries([
      { imei: ' 123 ', serialNumber: ' ' },
      { imei: '', serialNumber: ' SER-9 ' },
      {}
    ])).toEqual([
      { imei: '123', serialNumber: '123' },
      { imei: '', serialNumber: 'SER-9' },
      { imei: '', serialNumber: 'SER-3' }
    ]);
  });

  it('throws the current 404 error when a serialized product cannot be found', async () => {
    mocks.productFindOne.mockResolvedValue(null);

    await expect(productUnits.assertSerializedProduct('missing-product')).rejects.toMatchObject({
      message: 'Product not found',
      status: 404
    });
  });

  it('throws the current 400 error when a product is not serialized', async () => {
    mocks.productFindOne.mockResolvedValue({ id: 'p1', trackType: 'quantity' });

    await expect(productUnits.assertSerializedProduct('p1')).rejects.toMatchObject({
      message: 'Product is not serialized',
      status: 400
    });
  });

  it('rejects duplicate IMEIs in the same request before checking the database', async () => {
    await expect(productUnits.ensureUniqueUnitCodes([
      { imei: 'A1', serialNumber: 'S1' },
      { imei: 'A1', serialNumber: 'S2' }
    ])).rejects.toMatchObject({
      message: 'Duplicate IMEI in request: A1',
      status: 400
    });
    expect(mocks.productUnitFind).not.toHaveBeenCalled();
  });

  it('rejects already-existing serialized units from the database', async () => {
    mocks.productUnitFind.mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ imei: 'A1', serialNumber: 'S1' }])
    });

    await expect(productUnits.ensureUniqueUnitCodes([
      { imei: 'A1', serialNumber: 'S1' }
    ])).rejects.toMatchObject({
      message: 'Serialized unit already exists: A1',
      status: 400
    });
  });

  it('returns 404 when no serialized unit is available for reservation', async () => {
    mocks.productUnitFindOne.mockReturnValue({
      sort: vi.fn().mockResolvedValue(null)
    });

    await expect(productUnits.reserveSerializedUnit({
      code: 'IMEI-1',
      branchId: 'main',
      reservationToken: 'token-1'
    })).rejects.toMatchObject({
      message: 'Serialized unit not available',
      status: 404
    });
  });

  it('returns 409 when a serialized unit is reserved by another token', async () => {
    mocks.productUnitFindOne.mockReturnValue({
      sort: vi.fn().mockResolvedValue({
        _id: 'unit-1',
        status: 'reserved',
        reservationToken: 'token-2'
      })
    });

    await expect(productUnits.reserveSerializedUnit({
      code: 'IMEI-1',
      branchId: 'main',
      reservationToken: 'token-1'
    })).rejects.toMatchObject({
      message: 'Serialized unit already reserved',
      status: 409
    });
  });

  it('returns the updated reservation when the unit can be reserved', async () => {
    mocks.productUnitFindOne.mockReturnValue({
      sort: vi.fn().mockResolvedValue({
        _id: 'unit-1',
        status: 'in_stock',
        reservationToken: ''
      })
    });
    mocks.productUnitFindOneAndUpdate.mockResolvedValue({
      _id: 'unit-1',
      status: 'reserved',
      reservationToken: 'token-1'
    });

    const result = await productUnits.reserveSerializedUnit({
      code: 'IMEI-1',
      branchId: 'main',
      reservationToken: 'token-1'
    });

    expect(result).toMatchObject({
      _id: 'unit-1',
      status: 'reserved',
      reservationToken: 'token-1'
    });
  });
});
