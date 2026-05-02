import { useDispatch, useSelector } from 'react-redux';
import { useMemo, useState } from 'react';
import { approveRefund, rejectRefund, mergeRequests } from '../store/refundsSlice';
import { addAudit } from '../store/auditSlice';
import { recordSale } from '../store/salesSlice';
import { adjustStock } from '../store/productsSlice';
import { formatCurrency } from '../utils/currency';
import { promptDialog } from '../utils/dialogs';
import { useToast } from '../components/ToastProvider';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import * as refundsApi from '../api/refunds';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';

function RefundApprovalsPage() {
  const dispatch = useDispatch();
  const toast = useToast();
  const auth = useSelector(s => s.auth);
  const refunds = useSelector(s => s.refunds.requests);
  const sales = useSelector(s => s.sales.sales);
  const products = useSelector(s => s.products.products);
  const settings = useSelector(s => s.settings);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const branches = useSelector(s => s.branches.branches);
  const [filter, setFilter] = useState('pending');
  const [selectedId, setSelectedId] = useState(null);
  const [restockMode, setRestockMode] = useState('none'); // 'none' | 'full' | 'partial'
  const [partialMap, setPartialMap] = useState({}); // sku -> qty
  const [partialUnitMap, setPartialUnitMap] = useState({});
  const [approvalRemark, setApprovalRemark] = useState('');
  const [onlyBranch, setOnlyBranch] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const roleLower = String(auth.role || '').toLowerCase();
  const canApprove = ['admin','manager','superadmin'].includes(roleLower);
  // Remove restriction: anyone with permission should be able to approve, 
  // but logic inside onApprove will block self-approval if needed.
  // canSelfApprove logic remains in onApprove.

  function refundId(x) {
    return String(x?.id || x?._id || '');
  }

  const filtered = useMemo(() => {
    const currentBranchId = settings.currentBranchId;
    const me = auth.user?.name || '';
    let rows = refunds.slice().reverse();
    if (roleLower === 'cashier') {
      rows = rows.filter(r => String(r.initiatorName || '') === me);
    } else if (roleLower === 'manager') {
      rows = rows.filter(r => r.branchId === currentBranchId);
    } else {
      if (onlyBranch) rows = rows.filter(r => r.branchId === currentBranchId);
    }
    if (filter !== 'all') {
      const wanted = (filter === 'pending' ? 'pending_approval' : filter);
      rows = rows.filter(r => r.status === wanted);
    }
    return rows;
  }, [refunds, filter, settings.currentBranchId, roleLower, auth.user, onlyBranch]);

  function branchLabel(id) {
    const b = (branches || []).find(x => x.id === id);
    if (b) return b.name || b.code || id || '-';
    const s = sales.find(x => x.branchId === id);
    return s?.branchName || id || '-';
  }

  function onExportCsv() {
    const headers = [
      { key: 'ref', label: 'Ref', value: r => r.invoiceSerial || r.receiptNumber || r.saleId },
      { key: 'initiator', label: 'Initiator', value: r => r.initiatorName || '' },
      { key: 'branch', label: 'Branch', value: r => branchLabel(r.branchId) },
      { key: 'type', label: 'Type', value: r => String(r.type || '').toUpperCase() },
      { key: 'amount', label: 'Amount', value: r => String(r.requestedAmount || 0) },
      { key: 'created', label: 'Created', value: r => new Date(r.created_at).toLocaleString() },
      { key: 'status', label: 'Status', value: r => r.status.replace('_', ' ') },
      { key: 'approver', label: 'Approver', value: r => r.approverName || '' },
      { key: 'decision', label: 'Decision', value: r => r.restockMode ? r.restockMode : (r.usedRestock ? 'full' : 'none') },
      { key: 'remark', label: 'Remark', value: r => r.status === 'approved' ? (r.approvalRemark || '') : r.status === 'rejected' ? (r.rejectionRemark || '') : (r.remark || '') }
    ];
    exportCsv('refund-approvals.csv', headers, filtered);
  }
  function onExportPdf() {
    const headers = [
      { key: 'ref', label: 'Ref', value: r => r.invoiceSerial || r.receiptNumber || r.saleId },
      { key: 'initiator', label: 'Initiator', value: r => r.initiatorName || '' },
      { key: 'branch', label: 'Branch', value: r => branchLabel(r.branchId) },
      { key: 'type', label: 'Type', value: r => String(r.type || '').toUpperCase() },
      { key: 'amount', label: 'Amount', value: r => String(r.requestedAmount || 0) },
      { key: 'created', label: 'Created', value: r => new Date(r.created_at).toLocaleString() },
      { key: 'status', label: 'Status', value: r => r.status.replace('_', ' ') },
      { key: 'approver', label: 'Approver', value: r => r.approverName || '' },
      { key: 'decision', label: 'Decision', value: r => r.restockMode ? r.restockMode : (r.usedRestock ? 'full' : 'none') },
      { key: 'remark', label: 'Remark', value: r => r.status === 'approved' ? (r.approvalRemark || '') : r.status === 'rejected' ? (r.rejectionRemark || '') : (r.remark || '') }
    ];
    exportTablePdf('Refund Approvals', headers, filtered);
  }

  async function onReject(r) {
    if (!canApprove) return;
    const remark = await promptDialog('Enter reason for rejection (required)');
    if (!remark || !remark.trim()) {
      toast.show('Rejection reason is required', { type: 'error' });
      return;
    }
    const payload = { id: refundId(r), approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(rejectRefund(payload));
      try {
        await enqueueHttp({ collection: 'refundrequests', label: 'Refund reject', path: '/api/refunds/reject', method: 'POST', body: payload });
      } catch (e) {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
    } else {
      try {
        const saved = await refundsApi.reject(payload);
        dispatch(rejectRefund(payload));
        if (saved) dispatch(mergeRequests([saved]));
      } catch (e) {
        toast.show('Failed to sync to server', { type: 'error' });
        return;
      }
    }
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: 'refund_rejected',
      details: { refundId: r.id, saleId: r.saleId },
      remark,
      branchId: r.branchId,
      offline: !navigator.onLine
    }));
    toast.show(navigator.onLine ? 'Refund rejected' : 'Saved offline. Will backup when online.', { type: 'success' });
  }

  async function onApprove(r) {
    if (!canApprove) return;
    const isSelf = r.initiatorName && (auth.user?.name || '') === r.initiatorName;
    if (isSelf && roleLower !== 'superadmin' && roleLower !== 'admin') {
      toast.show('Initiator cannot approve own refund', { type: 'error' });
      return;
    }
    // Build restock payload based on current restockMode/partialMap
    const saleRef = sales.find(s => s.id === r.saleId);
    let restockItems = [];
    if (restockMode === 'full' && saleRef) {
      restockItems = Array.isArray(r.restockItems) && r.restockItems.length > 0
        ? r.restockItems.map(item => ({ sku: item.sku, productId: item.productId || '', variantId: item.variantId || '', qty: Number(item.qty) || 0, unitIds: Array.isArray(item.unitIds) ? item.unitIds.map(String) : [] }))
        : (saleRef.items || []).map(it => ({ sku: it.sku, productId: it.productId || '', variantId: it.variantId || '', qty: Number(it.qty) || 0, unitIds: Array.isArray(it.soldUnitIds) ? it.soldUnitIds.map(String) : [] }));
    } else if (restockMode === 'partial') {
      restockItems = (saleRef?.items || []).map(it => {
        const key = `${it.sku}:${it.productId || ''}:${it.variantId || ''}`;
        const unitIds = Array.isArray(partialUnitMap[key]) ? partialUnitMap[key] : [];
        return {
          sku: it.sku,
          productId: it.productId || '',
          variantId: it.variantId || '',
          qty: Array.isArray(it.soldUnits) && it.soldUnits.length > 0 ? unitIds.length : Number(partialMap[it.sku] || 0),
          unitIds
        };
      }).filter(x => x.qty > 0);
    }
    const payload = {
      id: refundId(r),
      approverName: auth.user?.name || 'unknown',
      approverRole: auth.role || '',
      approvalRemark: approvalRemark || '',
      restockMode,
      restockItems
    };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(approveRefund(payload));
      try {
        await enqueueHttp({ collection: 'refundrequests', label: 'Refund approve', path: '/api/refunds/approve', method: 'POST', body: payload });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
    } else {
      try {
        const saved = await refundsApi.approve(payload);
        dispatch(approveRefund(payload));
        if (saved?.request) dispatch(mergeRequests([saved.request]));
      } catch {
        toast.show('Failed to sync to server', { type: 'error' });
        return;
      }
    }
    if (saleRef) {
      const amt = Math.round((Number(r.requestedAmount) || 0) * 100) / 100;
      dispatch(recordSale({
        id: `refund-${refundId(r)}`,
        branchId: saleRef.branchId,
        branchName: saleRef.branchName || branchLabel(saleRef.branchId),
        sellerName: auth.user?.name || 'unknown',
        sellerRole: auth.role || '',
        items: [{ name: `REFUND ${saleRef.invoiceSerial || saleRef.receiptNumber || saleRef.id}`, sku: 'REFUND', qty: 1, price: -amt }],
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: -amt,
        payment_methods: [{ type: 'refund', amount: -amt }],
        status: 'completed',
        created_at: new Date().toISOString(),
        invoiceSerial: '',
        receiptNumber: ''
      }));
      if (restockMode === 'full' || restockMode === 'partial') {
        const skuToRef = new Map();
        products.forEach(p => {
          if (Array.isArray(p.variants) && p.variants.length > 0) {
            p.variants.forEach(v => {
              skuToRef.set(v.sku || `${p.sku}-${v.label}`, { productId: p.id, variantId: v.id });
            });
          } else {
            skuToRef.set(p.sku, { productId: p.id, variantId: null });
          }
        });
        const itemsToRestock = restockMode === 'full'
          ? restockItems
          : restockItems;
        itemsToRestock.forEach(x => {
          const ref = skuToRef.get(x.sku);
          if (ref && x.qty > 0) {
            dispatch(adjustStock({
              productId: ref.productId,
              variantId: ref.variantId,
              branchId: saleRef.branchId,
              delta: x.qty,
              inventoryType: String(saleRef.inventoryType || 'retail').toLowerCase() === 'warehouse'
                ? 'warehouse'
                : String(saleRef.inventoryType || 'retail').toLowerCase() === 'wholesale'
                  ? 'wholesale'
                  : 'retail'
            }));
          }
        });
        void refreshAffectedProducts(dispatch, itemsToRestock.map(x => x.productId).filter(Boolean));
        const totalUnits = itemsToRestock.reduce((s, x) => s + (Number(x.qty) || 0), 0);
        dispatch(addAudit({
          actor: auth.user?.name || 'unknown',
          actionType: 'stock_restock_refund',
          details: { items: itemsToRestock, totalUnits, saleId: r.saleId },
          remark: approvalRemark || '',
          branchId: saleRef.branchId,
          offline: !navigator.onLine
        }));
      }
    }
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: 'refund_approved',
      details: { refundId: refundId(r), saleId: r.saleId, amount: r.requestedAmount, restockMode },
      branchId: r.branchId,
      offline: !navigator.onLine
    }));
    toast.show(navigator.onLine ? 'Refund approved and recorded' : 'Saved offline. Will backup when online.', { type: 'success' });
    setSelectedId(null);
    setRestockMode('none');
    setPartialMap({});
    setPartialUnitMap({});
    setApprovalRemark('');
  }

  function openReview(e, id) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setSelectedId(String(id || ''));
    setRestockMode('none');
    setPartialMap({});
    setPartialUnitMap({});
    setApprovalRemark('');
  }

  function closeReview(e) {
    if (e) e.stopPropagation();
    setSelectedId(null);
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Refund Approvals</h1>
        <OfflineQueueIndicator collection="refundrequests" label="Refunds queued" />
      </div>
      <div className="filter-actions" style={{ marginBottom: 12 }}>
        <button className={`btn ${filter==='pending' ? 'btn-primary' : ''}`} onClick={() => setFilter('pending')}>Pending</button>
        <button className={`btn ${filter==='approved' ? 'btn-primary' : ''}`} onClick={() => setFilter('approved')}>Approved</button>
        <button className={`btn ${filter==='rejected' ? 'btn-primary' : ''}`} onClick={() => setFilter('rejected')}>Rejected</button>
        <button className={`btn ${filter==='all' ? 'btn-primary' : ''}`} onClick={() => setFilter('all')}>All</button>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={roleLower === 'manager' ? true : onlyBranch}
            onChange={e => setOnlyBranch(e.target.checked)}
            disabled={roleLower === 'manager' || roleLower === 'cashier'}
          />
          <span>Only current branch</span>
        </label>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 8 }}>
          <button className="btn" onClick={onExportCsv}>Export CSV</button>
          <button className="btn" onClick={onExportPdf}>Export PDF</button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th align="left">Ref</th>
              <th align="left">Initiator</th>
              <th align="left">Branch</th>
              <th align="left">Type</th>
              <th align="left">Amount</th>
              <th align="left">Created</th>
              <th align="left">Status</th>
              <th align="left">Approver</th>
              <th align="left">Decision</th>
              <th align="left">Remark</th>
              <th align="right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(r => (
              <tr key={refundId(r)} onClick={(e) => openReview(e, refundId(r))} style={{ cursor: 'pointer' }}>
                <td>{r.invoiceSerial || r.receiptNumber || r.saleId}</td>
                <td>{r.initiatorName}</td>
                <td>{branchLabel(r.branchId)}</td>
                <td>{String(r.type || '').toUpperCase()}</td>
                <td>{formatCurrency(r.requestedAmount || 0, settings)}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.status.replace('_', ' ')}</td>
                <td>{r.approverName || '—'}</td>
                <td>{r.restockMode ? r.restockMode : (r.usedRestock ? 'full' : 'none')}</td>
                <td>{r.status === 'approved' ? (r.approvalRemark || '—') : r.status === 'rejected' ? (r.rejectionRemark || '—') : (r.remark || '—')}</td>
                <td align="right">
                  <button className="btn btn-sm" onClick={(e) => openReview(e, refundId(r))}>Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span>Page {page} of {Math.max(1, Math.ceil(filtered.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(filtered.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(filtered.length / pageSize))}>Next</button>
          </div>
          <label>
            <span style={{ marginRight: 6 }}>Rows</span>
            <select className="select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>
      {selectedId && (() => {
        const r = refunds.find(x => refundId(x) === String(selectedId || ''));
        const saleRef = r ? sales.find(s => s.id === r.saleId) : null;
        const items = saleRef?.items || [];
        return r ? (
          <div
            onClick={closeReview}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          >
            <div className="card" onClick={e => e.stopPropagation()} style={{ width: 'min(920px, 95vw)', maxHeight: '85vh', overflow: 'auto', position: 'relative', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="section-title" style={{ margin: 0 }}>Review Refund</h2>
                <button className="btn" onClick={closeReview}>Close</button>
              </div>
              <div style={{ color: '#64748b', marginTop: 6 }}>
                {r.invoiceSerial || r.receiptNumber || r.saleId} • {branchLabel(r.branchId)} • Initiated by {r.initiatorName} on {new Date(r.created_at).toLocaleString()}
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700 }}>Initiator Remark</div>
                <div>{r.remark || '—'}</div>
              </div>
              {Array.isArray(r.images) && r.images.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {r.images.map((src, i) => (
                    <a key={i} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt={`evidence-${i}`} style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                    </a>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Sale Items</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left">Item</th>
                      <th align="left">SKU</th>
                      <th align="left">Qty</th>
                      {restockMode === 'partial' && <th align="left">Restock Qty</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          <div style={{ color: '#111827' }}>{it.name}{it.spec ? ` [${it.spec}]` : ''}</div>
                          {Array.isArray(it.soldUnits) && it.soldUnits.length > 0 && (
                            <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                              {it.soldUnits.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ')}
                            </div>
                          )}
                        </td>
                        <td style={{ color: '#111827' }}>{it.sku}</td>
                        <td style={{ color: '#111827' }}>{it.qty}</td>
                        {restockMode === 'partial' && (
                          <td>
                            {Array.isArray(it.soldUnits) && it.soldUnits.length > 0 ? (
                              <div style={{ display: 'grid', gap: 4 }}>
                                {it.soldUnits.map(unit => {
                                  const key = `${it.sku}:${it.productId || ''}:${it.variantId || ''}`;
                                  const checked = (partialUnitMap[key] || []).includes(unit.unitId);
                                  return (
                                    <label key={unit.unitId} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#111827' }}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={e => setPartialUnitMap(prev => {
                                          const current = new Set(prev[key] || []);
                                          if (e.target.checked) current.add(unit.unitId);
                                          else current.delete(unit.unitId);
                                          return { ...prev, [key]: Array.from(current) };
                                        })}
                                      />
                                      <span style={{ color: '#111827' }}>{unit.imei || unit.serialNumber || unit.unitId}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <input
                                className="input"
                                type="number"
                                min="0"
                                max={Number(it.qty) || 0}
                                value={partialMap[it.sku] ?? 0}
                                onChange={e => setPartialMap(m => ({ ...m, [it.sku]: Math.max(0, Math.min(Number(e.target.value) || 0, Number(it.qty) || 0)) }))}
                                style={{ width: 100, color: '#111827' }}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.status === 'pending_approval' && canApprove && (
                <div style={{ marginTop: 12, padding: 12, border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Decision</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" name={`restock-${r.id}`} checked={restockMode === 'none'} onChange={() => setRestockMode('none')} />
                      <span style={{ marginLeft: 8 }}>No Restock</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" name={`restock-${r.id}`} checked={restockMode === 'full'} onChange={() => setRestockMode('full')} />
                      <span style={{ marginLeft: 8 }}>Restock Fully</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" name={`restock-${r.id}`} checked={restockMode === 'partial'} onChange={() => setRestockMode('partial')} />
                      <span style={{ marginLeft: 8 }}>Restock Partially</span>
                    </label>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Approver Remark</div>
                    <input
                      className="input"
                      placeholder="Optional remark"
                      value={approvalRemark}
                      onChange={e => setApprovalRemark(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                    <button className="btn btn-primary" onClick={() => onApprove(r)} style={{ flex: 1 }}>Approve</button>
                    <button className="btn btn-danger" onClick={() => onReject(r)} style={{ flex: 1 }}>Reject</button>
                  </div>
                </div>
              )}
              {r.status !== 'pending_approval' && (
                <div style={{ marginTop: 12, color: '#64748b' }}>
                  Decision: {r.restockMode ? r.restockMode : (r.usedRestock ? 'full' : 'none')} • By: {r.approverName || '—'} {r.approverRole ? `(${r.approverRole})` : ''} • {r.approvalRemark || ''}
                </div>
              )}
            </div>
          </div>
        ) : null;
      })()}
    </div>
  );
}

export default RefundApprovalsPage;
