import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import Modal from '../components/Modal';
import { useToast } from '../components/ToastProvider';
import * as promotionsApi from '../api/promotions';
import * as productUnitsApi from '../api/productUnits';
import { formatCurrency } from '../utils/currency';
import { filterBranchesByType } from '../utils/branchTypes';
import { getProductStockAtBranch } from '../utils/branchStock';
import { comboRegularTotal, comboSetsAvailable, componentUnitPrice, findCatalogProduct, roundPromoMoney, syncPromoProfit } from '../utils/promotions';

function emptyCombo() {
  return {
    id: '',
    name: '',
    image: '',
    promoPrice: '',
    profitAmount: '',
    profitPercent: '',
    items: [
      { productId: '', variantId: '', qty: 1, units: [] },
      { productId: '', variantId: '', qty: 1, units: [] }
    ]
  };
}

function emptyForm() {
  return {
    name: '',
    active: true,
    allBranches: true,
    branchIds: [],
    combos: [emptyCombo()]
  };
}

function readComboImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    if (!String(file.type || '').startsWith('image/')) {
      reject(new Error('Choose an image file'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image'));
      img.onload = () => {
        const maxEdge = 640;
        const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
        canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Could not read that image'));
          return;
        }
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.72);
        if (data.length > 700000) {
          reject(new Error('That image is still too large. Choose a smaller photo.'));
          return;
        }
        resolve(data);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function PromotionsPage() {
  const toast = useToast();
  const products = useSelector((state) => state.products.products || []);
  const branches = useSelector((state) => state.branches.branches || []);
  const settings = useSelector((state) => state.settings);
  const retailBranches = useMemo(() => filterBranchesByType(branches, 'retail'), [branches]);
  const branchNameById = useMemo(() => new Map(retailBranches.map((branch) => [String(branch.id), branch.name || 'Branch'])), [retailBranches]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState(null);
  const [unitLists, setUnitLists] = useState({});
  const unitListRef = useRef({});

  async function load() {
    setLoading(true);
    try {
      const list = await promotionsApi.list();
      setRows(Array.isArray(list) ? list : []);
    } catch (error) {
      toast.show(String(error?.message || 'Failed to load promotions'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditor(emptyForm());
  }

  function openEdit(row) {
    setEditor({
      id: row._id,
      name: row.name || '',
      active: row.active !== false,
      allBranches: row.allBranches !== false,
      branchIds: Array.isArray(row.branchIds) ? row.branchIds.map(String) : [],
      combos: (Array.isArray(row.combos) && row.combos.length > 0 ? row.combos : [emptyCombo()]).map((combo) => ({
        id: combo.id || '',
        name: combo.name || '',
        image: combo.image || '',
        promoPrice: combo.promoPrice ?? '',
        profitAmount: combo.profitAmount ?? '',
        profitPercent: combo.profitPercent ?? '',
        items: (Array.isArray(combo.items) && combo.items.length > 0 ? combo.items : emptyCombo().items).map((item) => ({
          productId: item.productId || '',
          variantId: item.variantId || '',
          qty: item.qty || 1,
          units: Array.isArray(item.units) ? item.units.map((unit) => ({
            unitId: unit.unitId || unit._id || '',
            imei: unit.imei || '',
            serialNumber: unit.serialNumber || '',
            branchId: unit.branchId || ''
          })) : []
        }))
      }))
    });
  }

  function patchCombo(index, patch, edited) {
    setEditor((current) => {
      if (!current) return current;
      const combos = current.combos.map((combo, comboIndex) => {
        if (comboIndex !== index) return combo;
        const next = { ...combo, ...patch };
        if (edited) {
          const synced = syncPromoProfit({
            promoPrice: next.promoPrice,
            profitAmount: next.profitAmount,
            profitPercent: next.profitPercent,
            edited
          });
          next.promoPrice = synced.promoPrice;
          next.profitAmount = synced.profitAmount;
          next.profitPercent = synced.profitPercent;
        }
        return next;
      });
      return { ...current, combos };
    });
  }

  function patchComboItem(comboIndex, itemIndex, patch) {
    setEditor((current) => {
      if (!current) return current;
      const combos = current.combos.map((combo, index) => {
        if (index !== comboIndex) return combo;
        const items = combo.items.map((item, rowIndex) => (rowIndex === itemIndex ? { ...item, ...patch } : item));
        return { ...combo, items };
      });
      return { ...current, combos };
    });
  }

  async function loadUnitList(productId, variantId) {
    const key = `${productId}:${variantId || ''}`;
    if (unitListRef.current[key]) return;
    unitListRef.current[key] = 'loading';
    setUnitLists((current) => ({ ...current, [key]: { loading: true, rows: current[key]?.rows || [], total: 0 } }));
    try {
      const result = await productUnitsApi.listProductUnits({
        productId,
        variantId: variantId || '',
        inventoryType: 'retail',
        status: 'in_stock',
        page: 1,
        pageSize: 500
      });
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      unitListRef.current[key] = 'done';
      setUnitLists((current) => ({ ...current, [key]: { loading: false, rows, total: Number(result?.total || rows.length) } }));
    } catch (error) {
      unitListRef.current[key] = '';
      setUnitLists((current) => ({ ...current, [key]: { loading: false, rows: [], total: 0, error: String(error?.message || 'Could not load units') } }));
    }
  }

  useEffect(() => {
    if (!editor) return undefined;
    editor.combos.forEach((combo) => {
      (combo.items || []).forEach((item) => {
        const product = findCatalogProduct(products, item.productId);
        if (String(product?.trackType || '') !== 'serialized') return;
        const variants = Array.isArray(product?.variants) ? product.variants.filter((variant) => String(variant?.id || '').trim()) : [];
        if (variants.length > 0 && !item.variantId) return;
        const productId = String(product.id || product._id || '');
        if (!productId) return;
        void loadUnitList(productId, item.variantId || '');
      });
    });
    return undefined;
  }, [editor, products]);

  function toggleComboUnit(comboIndex, itemIndex, unit, checked) {
    setEditor((current) => {
      if (!current) return current;
      const combos = current.combos.map((combo, index) => {
        if (index !== comboIndex) return combo;
        const items = combo.items.map((item, rowIndex) => {
          if (rowIndex !== itemIndex) return item;
          const currentUnits = Array.isArray(item.units) ? item.units : [];
          const unitId = String(unit._id || unit.unitId || '');
          const nextUnits = checked
            ? [...currentUnits.filter((row) => String(row.unitId) !== unitId), {
              unitId,
              imei: unit.imei || '',
              serialNumber: unit.serialNumber || '',
              branchId: String(unit.branchId || '')
            }]
            : currentUnits.filter((row) => String(row.unitId) !== unitId);
          return { ...item, units: nextUnits };
        });
        return { ...combo, items };
      });
      return { ...current, combos };
    });
  }

  async function onComboImage(comboIndex, file) {
    if (!file) return;
    try {
      const image = await readComboImage(file);
      patchCombo(comboIndex, { image });
    } catch (error) {
      toast.show(String(error?.message || 'Could not read that image'), { type: 'error' });
    }
  }

  async function save() {
    if (!editor || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: editor.name,
        active: editor.active,
        allBranches: editor.allBranches,
        branchIds: editor.branchIds,
        combos: editor.combos.map((combo) => ({
          id: combo.id || undefined,
          name: combo.name,
          image: combo.image || '',
          promoPrice: roundPromoMoney(combo.promoPrice),
          profitAmount: roundPromoMoney(combo.profitAmount),
          profitPercent: roundPromoMoney(combo.profitPercent),
          items: combo.items.map((item) => {
            const product = findCatalogProduct(products, item.productId);
            const serialized = String(product?.trackType || '') === 'serialized';
            if (!serialized) return { ...item, units: [] };
            const productId = String(product?.id || product?._id || '');
            const known = unitLists[`${productId}:${item.variantId || ''}`];
            if (!known || known.loading || !Array.isArray(known.rows)) return item;
            const liveIds = new Set(known.rows.map((row) => String(row._id || '')));
            return {
              ...item,
              units: (Array.isArray(item.units) ? item.units : []).filter((unit) => liveIds.has(String(unit.unitId || '')))
            };
          })
        }))
      };
      if (editor.id) await promotionsApi.update(editor.id, payload);
      else await promotionsApi.create(payload);
      toast.show(editor.id ? 'Promotion updated' : 'Promotion created');
      setEditor(null);
      await load();
    } catch (error) {
      toast.show(String(error?.message || 'Failed to save promotion'), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    try {
      await promotionsApi.update(row._id, { active: row.active === false });
      await load();
    } catch (error) {
      toast.show(String(error?.message || 'Failed to update promotion'), { type: 'error' });
    }
  }

  const branchLabel = (row) => {
    if (row.allBranches !== false) return 'All retail branches';
    const names = (row.branchIds || []).map((id) => retailBranches.find((branch) => String(branch.id) === String(id))?.name || id);
    return names.join(', ') || 'No branches';
  };

  return (
    <div className="page-shell">
      <div className="sales-section-head">
        <div>
          <h1>Promotions</h1>
          <p className="page-subtitle">Create a season, such as Christmas, then add named combos with their own promo price. Products sold on their own keep their normal prices.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>New Promotion</button>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        {loading ? <div>Loading promotions…</div> : null}
        {!loading && rows.length === 0 ? <div>No promotions yet.</div> : null}
        {!loading && rows.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Promotion</th>
                  <th align="left">Combos</th>
                  <th align="left">Branches</th>
                  <th align="left">Status</th>
                  <th align="left">Created</th>
                  <th align="left"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td>{row.name}</td>
                    <td>{Array.isArray(row.combos) ? row.combos.length : 0}</td>
                    <td>{branchLabel(row)}</td>
                    <td>{row.active === false ? 'Inactive' : 'Active'}</td>
                    <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn" onClick={() => openEdit(row)}>Edit</button>
                        <button className="btn" onClick={() => void toggleActive(row)}>{row.active === false ? 'Activate' : 'Deactivate'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {editor ? (
        <Modal
          title={editor.id ? 'Edit Promotion' : 'New Promotion'}
          onClose={() => { if (!saving) setEditor(null); }}
          footer={(
            <>
              <button className="btn" onClick={() => setEditor(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <label>
              <div className="field-label">Promotion name</div>
              <input className="input" value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder="Christmas promo" />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={editor.active} onChange={(event) => setEditor({ ...editor, active: event.target.checked })} />
              Active on POS
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={editor.allBranches} onChange={(event) => setEditor({ ...editor, allBranches: event.target.checked, branchIds: event.target.checked ? [] : editor.branchIds })} />
              All retail branches
            </label>
            {!editor.allBranches ? (
              <div>
                <div className="field-label">Branches</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {retailBranches.map((branch) => {
                    const checked = editor.branchIds.includes(String(branch.id));
                    return (
                      <label key={branch.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const id = String(branch.id);
                            setEditor({
                              ...editor,
                              branchIds: event.target.checked ? [...editor.branchIds, id] : editor.branchIds.filter((value) => value !== id)
                            });
                          }}
                        />
                        {branch.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {editor.combos.map((combo, comboIndex) => {
              const preview = {
                items: combo.items,
                promoPrice: roundPromoMoney(combo.promoPrice)
              };
              const regular = comboRegularTotal(preview, products);
              const watchBranches = editor.allBranches ? retailBranches : retailBranches.filter((branch) => editor.branchIds.includes(String(branch.id)));
              const setsText = watchBranches.length === 0
                ? 'no branches selected'
                : watchBranches.map((branch) => `${branch.name} ${comboSetsAvailable(preview, products, branch.id)}`).join(', ');
              return (
                <div key={`${combo.id || 'new'}-${comboIndex}`} className="card" style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>Combo {comboIndex + 1}</strong>
                    {editor.combos.length > 1 ? (
                      <button className="btn" onClick={() => setEditor({ ...editor, combos: editor.combos.filter((_, index) => index !== comboIndex) })}>Remove combo</button>
                    ) : null}
                  </div>
                  <label>
                    <div className="field-label">Combo name</div>
                    <input className="input" value={combo.name} onChange={(event) => patchCombo(comboIndex, { name: event.target.value })} placeholder="Bread and peanut" />
                  </label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {combo.image ? (
                      <img src={combo.image} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    ) : (
                      <div style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>No image</div>
                    )}
                    <div style={{ display: 'grid', gap: 6 }}>
                      <label className="btn" style={{ width: 'fit-content' }}>
                        {combo.image ? 'Change image' : 'Upload image'}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(event) => {
                            const file = event.target.files && event.target.files[0];
                            event.target.value = '';
                            void onComboImage(comboIndex, file);
                          }}
                        />
                      </label>
                      {combo.image ? (
                        <button type="button" className="btn" onClick={() => patchCombo(comboIndex, { image: '' })}>Remove image</button>
                      ) : null}
                    </div>
                  </div>
                  {combo.items.map((item, itemIndex) => {
                    const product = findCatalogProduct(products, item.productId);
                    const variants = (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => String(variant?.id || '').trim());
                    const serialized = String(product?.trackType || '') === 'serialized';
                    const productId = String(product?.id || product?._id || '');
                    const unitKey = `${productId}:${item.variantId || ''}`;
                    const unitList = unitLists[unitKey] || { loading: false, rows: [], total: 0 };
                    const allowedBranchIds = new Set((watchBranches || []).map((branch) => String(branch.id)));
                    const selectedUnits = Array.isArray(item.units) ? item.units : [];
                    const visibleUnits = serialized
                      ? [
                        ...unitList.rows.filter((row) => allowedBranchIds.size === 0 || allowedBranchIds.has(String(row.branchId || ''))),
                        ...selectedUnits
                          .filter((unit) => !unitList.rows.some((row) => String(row._id) === String(unit.unitId)))
                          .map((unit) => ({ ...unit, _id: unit.unitId, missing: true }))
                      ]
                      : [];
                    const selectedCount = selectedUnits.length;
                    const each = Math.max(1, Number(item.qty || 1));
                    const unitReady = !serialized || (selectedCount >= each && selectedCount % each === 0);
                    return (
                      <div key={`${comboIndex}-${itemIndex}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(120px, 0.8fr) 90px auto', gap: 8, alignItems: 'end' }}>
                        <label>
                          <div className="field-label">Product</div>
                          <select className="select" value={item.productId} onChange={(event) => patchComboItem(comboIndex, itemIndex, { productId: event.target.value, variantId: '', units: [] })}>
                            <option value="">Select product</option>
                            {products.map((entry) => (
                              <option key={entry.id || entry._id} value={entry.id || entry._id}>{entry.name}{String(entry.trackType || '') === 'serialized' ? ' (serialized)' : ''}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <div className="field-label">Variant</div>
                          <select className="select" value={item.variantId} onChange={(event) => patchComboItem(comboIndex, itemIndex, { variantId: event.target.value, units: [] })} disabled={variants.length === 0}>
                            <option value="">{variants.length ? 'Select variant' : 'None'}</option>
                            {variants.map((variant) => (
                              <option key={variant.id} value={variant.id}>{variant.label || variant.sku || variant.id}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <div className="field-label">Qty per sale</div>
                          <input className="input" type="number" min="1" value={item.qty} onChange={(event) => patchComboItem(comboIndex, itemIndex, { qty: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} />
                        </label>
                        <button className="btn" onClick={() => patchCombo(comboIndex, { items: combo.items.filter((_, index) => index !== itemIndex) })} disabled={combo.items.length <= 2}>Remove</button>
                        <div style={{ gridColumn: '1 / -1', color: '#64748b', fontSize: 12 }}>
                          Normal price {formatCurrency(componentUnitPrice(product, item.variantId), settings)}
                          {serialized
                            ? ` · ${selectedCount} unit${selectedCount === 1 ? '' : 's'} selected`
                            : watchBranches.slice(0, 3).map((branch) => ` · ${branch.name} stock ${getProductStockAtBranch(product, { variantId: item.variantId, branchId: branch.id, inventoryType: 'retail' })}`).join('')}
                        </div>
                        {serialized ? (
                          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 6 }}>
                            <div style={{ fontSize: 12, color: unitReady ? '#64748b' : '#b45309' }}>
                              Select the exact units that belong in this combo. Each sale takes {each}. The number selected must be a multiple of {each}, so this combo can be sold {Math.floor(selectedCount / each)} time{Math.floor(selectedCount / each) === 1 ? '' : 's'} from the current selection.
                            </div>
                            {variants.length > 0 && !item.variantId ? <div style={{ fontSize: 12, color: '#64748b' }}>Choose a variant to see its units.</div> : null}
                            {unitList.loading ? <div style={{ fontSize: 12, color: '#64748b' }}>Loading units…</div> : null}
                            {unitList.error ? <div style={{ fontSize: 12, color: '#b91c1c' }}>{unitList.error}</div> : null}
                            {!unitList.loading && (variants.length === 0 || item.variantId) && visibleUnits.length === 0 ? (
                              <div style={{ fontSize: 12, color: '#64748b' }}>No in-stock units for the selected branches.</div>
                            ) : null}
                            {visibleUnits.length > 0 ? (
                              <div style={{ display: 'grid', gap: 4, maxHeight: 180, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                                {visibleUnits.map((unit) => {
                                  const unitId = String(unit._id || unit.unitId || '');
                                  const checked = selectedUnits.some((row) => String(row.unitId) === unitId);
                                  const label = unit.imei || unit.serialNumber || unitId;
                                  const branchName = branchNameById.get(String(unit.branchId || '')) || 'Branch';
                                  return (
                                    <label key={unitId} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) => toggleComboUnit(comboIndex, itemIndex, unit, event.target.checked)}
                                      />
                                      <span>{label}</span>
                                      <span style={{ color: '#64748b' }}>{branchName}</span>
                                      {unit.missing ? <span style={{ color: '#b45309' }}>Not currently in stock</span> : null}
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}
                            {Number(unitList.total || 0) > visibleUnits.length ? (
                              <div style={{ fontSize: 12, color: '#64748b' }}>Showing the first in-stock units. Search is limited to 500 units for this product.</div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  <button className="btn" onClick={() => patchCombo(comboIndex, { items: [...combo.items, { productId: '', variantId: '', qty: 1, units: [] }] })}>Add product</button>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    <label>
                      <div className="field-label">Promo price</div>
                      <input className="input" type="number" min="0" step="0.01" value={combo.promoPrice} onChange={(event) => patchCombo(comboIndex, { promoPrice: event.target.value }, 'price')} />
                    </label>
                    <label>
                      <div className="field-label">Profit amount</div>
                      <input className="input" type="number" min="0" step="0.01" value={combo.profitAmount} onChange={(event) => patchCombo(comboIndex, { profitAmount: event.target.value }, 'amount')} />
                    </label>
                    <label>
                      <div className="field-label">Profit %</div>
                      <input className="input" type="number" min="0" step="0.01" value={combo.profitPercent} onChange={(event) => patchCombo(comboIndex, { profitPercent: event.target.value }, 'percent')} />
                    </label>
                  </div>
                  <div style={{ color: '#334155', fontSize: 13 }}>
                    Sold separately: {formatCurrency(regular, settings)}. Promo revenue: {formatCurrency(roundPromoMoney(combo.promoPrice), settings)}. Profit added per combo: {formatCurrency(roundPromoMoney(combo.profitAmount), settings)} ({roundPromoMoney(combo.profitPercent)}%). Sets available: {setsText}.
                  </div>
                </div>
              );
            })}
            <button className="btn" onClick={() => setEditor({ ...editor, combos: [...editor.combos, emptyCombo()] })}>Add another combo</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default PromotionsPage;
