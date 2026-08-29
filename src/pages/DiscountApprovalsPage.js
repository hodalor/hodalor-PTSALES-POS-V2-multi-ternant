import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Modal from '../components/Modal';
import { formatCurrency } from '../utils/currency';
import { useToast } from '../components/ToastProvider';
import { approveDiscountApproval, cancelDiscountApproval, listDiscountApprovals, rejectDiscountApproval } from '../api/discountApprovals';
import { createSale } from '../api/sales';
import { releaseProductUnits } from '../api/productUnits';
import { confirmDialog } from '../utils/dialogs';
import { buildBrandedReceiptHtml, printReceiptHtml } from '../utils/print';
import { useAppLanguage } from '../utils/localization';
import { getProductDisplayMeta } from '../utils/inventoryFilters';

function computeTaxRate(subtotal = 0, discount = 0, tax = 0) {
  const taxable = Math.max(0, Number(subtotal || 0) - Number(discount || 0));
  if (taxable <= 0) return 0;
  return Math.max(0, Number(tax || 0)) / taxable;
}

function adjustPaymentMethods(paymentMethods = [], nextTotal = 0) {
  const methods = Array.isArray(paymentMethods) ? paymentMethods.map((entry) => ({
    ...entry,
    amount: Math.max(0, Number(entry?.amount || 0))
  })) : [];
  const currentTotal = methods.reduce((sum, entry) => sum + Math.max(0, Number(entry?.amount || 0)), 0);
  const delta = Number(nextTotal || 0) - currentTotal;
  if (methods.length === 0) return [{ type: 'cash', amount: Math.max(0, Number(nextTotal || 0)) }];
  const cashIndex = methods.findIndex((entry) => String(entry?.type || '').toLowerCase() === 'cash');
  const targetIndex = cashIndex >= 0 ? cashIndex : methods.length - 1;
  methods[targetIndex] = {
    ...methods[targetIndex],
    amount: Math.max(0, Number(methods[targetIndex]?.amount || 0) + delta)
  };
  return methods;
}

function normalizeResolvedPayload(row, mode = 'approved') {
  const base = row?.salePayload && typeof row.salePayload === 'object' ? { ...row.salePayload } : {};
  if (mode !== 'rejected_complete') return base;
  const subtotal = Math.max(0, Number(row?.subtotal || base?.subtotal || 0));
  const taxRate = computeTaxRate(subtotal, row?.discount || base?.discount || 0, row?.tax || base?.tax || 0);
  const nextTax = Math.max(0, subtotal * taxRate);
  const nextTotal = Math.max(0, subtotal + nextTax);
  return {
    ...base,
    subtotal,
    discount: 0,
    tax: nextTax,
    total: nextTotal,
    payment_methods: adjustPaymentMethods(base?.payment_methods, nextTotal)
  };
}

function buildStatusLabel(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'under_review') return 'Under Review';
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  if (value === 'cancelled') return 'Cancelled';
  return 'Completed';
}

function requestUnitIds(row = {}) {
  const payloadItems = Array.isArray(row?.salePayload?.items) ? row.salePayload.items : [];
  return Array.from(new Set(
    payloadItems.flatMap((item) => {
      const soldUnitIds = Array.isArray(item?.soldUnitIds) ? item.soldUnitIds : [];
      const soldUnits = Array.isArray(item?.soldUnits) ? item.soldUnits.map((unit) => unit?.unitId) : [];
      return [...soldUnitIds, ...soldUnits].map(String).filter(Boolean);
    })
  ));
}

function DiscountApprovalsPage() {
  const settings = useSelector((s) => s.settings);
  const auth = useSelector((s) => s.auth);
  const branches = useSelector((s) => s.branches.branches || []);
  const products = useSelector((s) => s.products.products || []);
  const { t } = useAppLanguage();
  const toast = useToast();
  const [tab, setTab] = useState('under_review');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [detail, setDetail] = useState(null);
  const [draftDiscount, setDraftDiscount] = useState('');
  const [draftRemark, setDraftRemark] = useState('');

  const canComplete = useMemo(() => {
    const role = String(auth.role || '').toLowerCase();
    const grants = Array.isArray(auth.grants) ? auth.grants : [];
    return role === 'superadmin' || role === 'admin' || grants.includes('add_sales');
  }, [auth.grants, auth.role]);

  const branchMap = useMemo(() => {
    const map = new Map();
    (branches || []).forEach((branch) => {
      const label = branch.name || branch.code || branch.id || branch._id;
      if (branch.id) map.set(String(branch.id), label);
      if (branch._id) map.set(String(branch._id), label);
    });
    return map;
  }, [branches]);

  const load = useCallback(async (activeStatus = tab) => {
    setLoading(true);
    try {
      const data = await listDiscountApprovals({ status: activeStatus, force: true });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load discount approvals'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  function openDetail(row) {
    setDetail(row);
    setDraftDiscount(String(Number(row?.reviewedDiscount ?? row?.discount ?? 0)));
    setDraftRemark(String(row?.approvalRemark || row?.rejectionRemark || ''));
  }

  function closeDetail(force = false) {
    if (workingId && !force) return;
    setDetail(null);
    setDraftDiscount('');
    setDraftRemark('');
  }

  async function maybePrintReceipt(sale) {
    const shouldPrint = await confirmDialog('Print receipt now?');
    if (!shouldPrint) return;
    printReceiptHtml(buildBrandedReceiptHtml({ settings, sale }));
  }

  async function onApprove(row = detail) {
    const id = String(row?._id || '');
    if (!id) return;
    setWorkingId(id);
    try {
      await approveDiscountApproval(id, {
        discount: Number(draftDiscount || 0),
        remark: String(draftRemark || '')
      });
      toast.show('Discount approved', { type: 'success' });
      closeDetail(true);
      await load(tab);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to approve discount'), { type: 'error' });
    } finally {
      setWorkingId('');
    }
  }

  async function onReject(row = detail) {
    const id = String(row?._id || '');
    if (!id) return;
    if (!String(draftRemark || '').trim()) {
      toast.show('Remark is required before rejecting', { type: 'error' });
      return;
    }
    setWorkingId(id);
    try {
      await rejectDiscountApproval(id, {
        remark: String(draftRemark || '').trim()
      });
      toast.show('Discount rejected', { type: 'success' });
      closeDetail(true);
      await load(tab);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to reject discount'), { type: 'error' });
    } finally {
      setWorkingId('');
    }
  }

  async function onComplete(row) {
    const id = String(row?._id || '');
    if (!id) return;
    if (!canComplete) {
      toast.show('You do not have permission to complete sales', { type: 'error' });
      return;
    }
    const mode = String(row?.status || '') === 'rejected' ? 'rejected_complete' : 'approved';
    setWorkingId(id);
    try {
      const payload = {
        ...normalizeResolvedPayload(row, mode),
        clientId: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `discount-sale-${Date.now()}`,
        discountApprovalId: id
      };
      const saved = await createSale(payload);
      const saleForPrint = {
        ...saved,
        branchName: branchMap.get(String(saved?.branchId || row?.branchId || '')) || row?.branchName || ''
      };
      await maybePrintReceipt(saleForPrint);
      toast.show(mode === 'rejected_complete' ? 'Rejected discount sale completed without discount' : 'Discounted sale completed', { type: 'success' });
      closeDetail(true);
      await load(tab);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to complete discounted sale'), { type: 'error' });
    } finally {
      setWorkingId('');
    }
  }

  async function onCancel(row = detail) {
    const id = String(row?._id || '');
    if (!id) return;
    const confirm = await confirmDialog('Cancel this rejected discount sale?');
    if (!confirm) return;
    setWorkingId(id);
    try {
      const unitIds = requestUnitIds(row);
      if (unitIds.length > 0 && row?.salePayload?.reservationToken) {
        await releaseProductUnits({ unitIds, reservationToken: String(row.salePayload.reservationToken || '') });
      }
      await cancelDiscountApproval(id, { remark: String(draftRemark || '') });
      toast.show('Rejected discount sale cancelled', { type: 'success' });
      closeDetail(true);
      await load(tab);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to cancel discounted sale'), { type: 'error' });
    } finally {
      setWorkingId('');
    }
  }

  const rowsForTable = useMemo(() => {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => new Date(b?.updatedAt || b?.createdAt || 0).getTime() - new Date(a?.updatedAt || a?.createdAt || 0).getTime());
  }, [rows]);

  function detailItems(row) {
    const items = Array.isArray(row?.items) && row.items.length > 0 ? row.items : (Array.isArray(row?.salePayload?.items) ? row.salePayload.items : []);
    return items.map((item, index) => {
      const meta = getProductDisplayMeta(products, item?.productId, item?.variantId, item);
      return {
        key: `${item?.productId || 'row'}-${item?.variantId || ''}-${index}`,
        name: meta.productName || item?.name || item?.sku || item?.productId || '—',
        sub: [meta.variantLabel, meta.attributeText, item?.sku].filter(Boolean).join(' • '),
        qty: Number(item?.qty || 0),
        price: Number(item?.price || 0),
        soldUnits: Array.isArray(item?.soldUnits) ? item.soldUnits : []
      };
    });
  }

  const activeDetailItems = detail ? detailItems(detail) : [];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>{t('Discount Approval')}</h1>
          <div className="page-subtitle-compact">Review, approve, reject, complete, and track discounted sales with full accountability.</div>
        </div>
      </div>
      <div className="filter-actions" style={{ marginBottom: 12 }}>
        <button className={`btn ${tab === 'under_review' ? 'btn-primary' : ''}`} onClick={() => setTab('under_review')}>
          {t('Under Review')}
        </button>
        <button className={`btn ${tab === 'approved' ? 'btn-primary' : ''}`} onClick={() => setTab('approved')}>
          {t('Approved')}
        </button>
        <button className={`btn ${tab === 'completed' ? 'btn-primary' : ''}`} onClick={() => setTab('completed')}>
          {t('Completed')}
        </button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th align="left">{t('Created')}</th>
                <th align="left">{t('Branch')}</th>
                <th align="left">{t('Customer')}</th>
                <th align="left">{t('Items')}</th>
                <th align="left">{t('Discount')}</th>
                <th align="left">{t('Total')}</th>
                <th align="left">{t('Initiator')}</th>
                <th align="left">{t('Approver')}</th>
                <th align="left">{t('Completer')}</th>
                <th align="left">{t('Status')}</th>
                <th align="right">{t('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {rowsForTable.map((row) => {
                const id = String(row?._id || '');
                const itemSummary = Array.isArray(row?.items) ? row.items.map((item) => `${item.name || item.sku || item.productId} x${Number(item.qty || 0)}`).join(', ') : '';
                const busy = workingId === id;
                return (
                  <tr key={id} onClick={() => openDetail(row)} style={{ cursor: 'pointer' }}>
                    <td>{row?.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                    <td>{branchMap.get(String(row?.branchId || '')) || row?.branchName || '—'}</td>
                    <td>{row?.customerName || row?.customerPhone || 'Walk-in'}</td>
                    <td style={{ maxWidth: 340 }}>{itemSummary || '—'}</td>
                    <td>{formatCurrency(row?.discount || 0, settings)}</td>
                    <td>{formatCurrency(row?.total || 0, settings)}</td>
                    <td>{row?.submittedByName || '—'}</td>
                    <td>{row?.approvedByName || row?.rejectedByName || '—'}</td>
                    <td>{row?.completedByName || '—'}</td>
                    <td>{buildStatusLabel(row?.status)}</td>
                    <td align="right" onClick={(e) => e.stopPropagation()}>
                      {tab === 'under_review' && (
                        <>
                          <button className="btn btn-primary" onClick={() => openDetail(row)} disabled={busy}>
                            {busy ? t('Working...') : t('Approve')}
                          </button>
                        </>
                      )}
                      {tab === 'approved' && (
                        <button className="btn btn-primary" onClick={() => onComplete(row)} disabled={busy || !canComplete}>
                          {busy ? t('Working...') : t('Complete')}
                        </button>
                      )}
                      {tab === 'completed' && (
                        <button className="btn" onClick={() => openDetail(row)}>
                          {t('View')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rowsForTable.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ color: '#64748b' }}>
                    {loading ? t('Loading...') : t('No discount approvals found')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <Modal
          title={`${t('Discount Request')} • ${buildStatusLabel(detail?.status)}`}
          onClose={closeDetail}
          footer={(
            <>
              <button className="btn" onClick={closeDetail} disabled={!!workingId}>{t('Close')}</button>
              {String(detail?.status || '') === 'under_review' && (
                <>
                  <button className="btn" onClick={() => onReject(detail)} disabled={!!workingId}>{workingId ? t('Working...') : t('Reject')}</button>
                  <button className="btn btn-primary" onClick={() => onApprove(detail)} disabled={!!workingId}>{workingId ? t('Working...') : t('Approve')}</button>
                </>
              )}
              {String(detail?.status || '') === 'approved' && (
                <button className="btn btn-primary" onClick={() => onComplete(detail)} disabled={!!workingId || !canComplete}>{workingId ? t('Working...') : t('Complete')}</button>
              )}
              {String(detail?.status || '') === 'rejected' && (
                <>
                  <button className="btn" onClick={() => onCancel(detail)} disabled={!!workingId}>{workingId ? t('Working...') : t('Cancel')}</button>
                  <button className="btn btn-primary" onClick={() => onComplete(detail)} disabled={!!workingId || !canComplete}>{workingId ? t('Working...') : t('Complete')}</button>
                </>
              )}
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div><strong>{t('Branch')}:</strong> {branchMap.get(String(detail?.branchId || '')) || detail?.branchName || '—'}</div>
              <div><strong>{t('Customer')}:</strong> {detail?.customerName || detail?.customerPhone || 'Walk-in'}</div>
              <div><strong>{t('Initiator')}:</strong> {detail?.submittedByName || '—'}</div>
              <div><strong>{t('Approver')}:</strong> {detail?.approvedByName || detail?.rejectedByName || '—'}</div>
              <div><strong>{t('Completer')}:</strong> {detail?.completedByName || '—'}</div>
              <div><strong>{t('Status')}:</strong> {buildStatusLabel(detail?.status)}</div>
            </div>

            {String(detail?.status || '') === 'under_review' ? (
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(180px, 220px) 1fr' }}>
                <div>
                  <div style={{ marginBottom: 6, fontWeight: 700 }}>{t('Discount Amount')}</div>
                  <input className="input" type="number" min="0" step="0.01" value={draftDiscount} onChange={(e) => setDraftDiscount(e.target.value)} />
                </div>
                <div>
                  <div style={{ marginBottom: 6, fontWeight: 700 }}>{t('Remark')}</div>
                  <textarea className="input" rows={4} value={draftRemark} onChange={(e) => setDraftRemark(e.target.value)} placeholder={t('Enter approval or rejection remark')} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                <div><strong>{t('Reviewed Discount')}:</strong> {formatCurrency(detail?.discount || 0, settings)}</div>
                {detail?.approvalRemark ? <div><strong>{t('Approval Remark')}:</strong> {detail.approvalRemark}</div> : null}
                {detail?.rejectionRemark ? <div><strong>{t('Rejection Remark')}:</strong> {detail.rejectionRemark}</div> : null}
              </div>
            )}

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('Products')}</div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left">{t('Product')}</th>
                      <th align="left">{t('Details')}</th>
                      <th align="right">{t('Qty')}</th>
                      <th align="right">{t('Price')}</th>
                      <th align="right">{t('Total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDetailItems.map((item) => (
                      <tr key={item.key}>
                        <td>{item.name}</td>
                        <td>
                          {item.sub || '—'}
                          {item.soldUnits.length > 0 ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>
                              {item.soldUnits.map((unit) => unit?.imei || unit?.serialNumber || unit?.unitId).filter(Boolean).join(', ')}
                            </div>
                          ) : null}
                        </td>
                        <td align="right">{item.qty}</td>
                        <td align="right">{formatCurrency(item.price || 0, settings)}</td>
                        <td align="right">{formatCurrency((item.price || 0) * (item.qty || 0), settings)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
              <div><strong>{t('Subtotal')}:</strong> {formatCurrency(detail?.subtotal || 0, settings)}</div>
              <div><strong>{t('Discount')}:</strong> {formatCurrency(detail?.discount || 0, settings)}</div>
              <div><strong>{t('Tax')}:</strong> {formatCurrency(detail?.tax || 0, settings)}</div>
              <div><strong>{t('Total')}:</strong> {formatCurrency(detail?.total || 0, settings)}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default DiscountApprovalsPage;
