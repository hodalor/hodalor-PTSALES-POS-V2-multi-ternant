import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useMemo, useState } from 'react';
import { createRefundRequest, mergeRequests } from '../store/refundsSlice';
import { addAudit } from '../store/auditSlice';
import { formatCurrency } from '../utils/currency';
import { useToast } from '../components/ToastProvider';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import * as refundsApi from '../api/refunds';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function RefundsPage({ mode = 'retail' }) {
  const dispatch = useDispatch();
  const toast = useToast();
  const settings = useSelector(s => s.settings);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const auth = useSelector(s => s.auth);
  const sales = useSelector(s => s.sales.sales);
  const branches = useSelector(s => s.branches.branches);
  const refunds = useSelector(s => s.refunds.requests);
  const [query, setQuery] = useState('');
  const [refundType, setRefundType] = useState('full');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [images, setImages] = useState([]);
  const [restock, setRestock] = useState(true);
  const [serializedSelections, setSerializedSelections] = useState({});
  const [lookupSale, setLookupSale] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const localSale = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return sales.find(s =>
      String(s.invoiceSerial || '').toLowerCase() === q.toLowerCase() ||
      String(s.receiptNumber || '').toLowerCase() === q.toLowerCase() ||
      String(s._id || s.id) === q
    ) || null;
  }, [query, sales]);
  const sale = lookupSale || localSale;
  const eligible = useMemo(() => {
    if (!sale) return 0;
    const v = Math.max(0, Number(sale.total || 0) - Number(sale.tax || 0));
    return Math.round(v * 100) / 100;
  }, [sale]);
  const roleLower = String(auth.role || '').toLowerCase();
  const isDistributionMode = String(mode || '').toLowerCase() === 'distribution';
  const pageTitle = isDistributionMode ? 'Distribution Refunds' : 'Refunds';
  const searchLabel = isDistributionMode ? 'Search Distribution Sale by Receipt or Invoice' : 'Search by Receipt or Invoice';
  const searchPlaceholder = isDistributionMode
    ? 'e.g., INV-WHOLESALE-000123 or RCPT-WHOLESALE-000123'
    : 'e.g., RCPT-XXX-000123 or INV-XXX-000123';
  const requestButtonLabel = isDistributionMode ? 'Request Distribution Refund' : 'Request Refund';
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const canRequest = roleLower === 'superadmin'
    || ['admin','manager','cashier'].includes(roleLower)
    || grants.includes('add_refunds')
    || grants.includes('add_distribution_refunds');
  const refundSummary = useMemo(() => ({
    total: refunds.length,
    pending: refunds.filter(r => String(r.status || '').includes('pending')).length,
    approved: refunds.filter(r => String(r.status || '') === 'approved').length,
    rejected: refunds.filter(r => String(r.status || '') === 'rejected').length,
    totalAmount: refunds.reduce((sum, r) => sum + (Number(r.amount || r.requestedAmount) || 0), 0)
  }), [refunds]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setLookupSale(null);
      setLookupError('');
      setLookupLoading(false);
      return () => {};
    }
    if (localSale) {
      setLookupSale(localSale);
      setLookupError('');
      setLookupLoading(false);
      return () => {};
    }
    setLookupLoading(true);
    setLookupError('');
    setLookupSale(null);
    refundsApi.lookupSale(q)
      .then((row) => {
        if (cancelled) return;
        const id = row?.id || row?._id || row?.clientId || '';
        setLookupSale(row ? { ...row, id: String(id || '') } : null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLookupSale(null);
        setLookupError(String(error?.message || 'Sale not found'));
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [localSale, query]);

  useEffect(() => {
    if (!sale) {
      setSerializedSelections({});
      return;
    }
    const next = {};
    (sale.items || []).forEach((item, index) => {
      const key = `${index}:${item.sku || ''}`;
      next[key] = Array.isArray(item.soldUnits) ? item.soldUnits.map(unit => unit.unitId).filter(Boolean) : [];
    });
    setSerializedSelections(next);
  }, [sale]);

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    const arr = [];
    for (const f of files) {
      const data = await toDataUrl(f);
      arr.push(data);
    }
    setImages(prev => prev.concat(arr).slice(0, 10));
  }
  function removeImage(i) {
    setImages(prev => prev.filter((_, idx) => idx !== i));
  }

  function branchLabel(id) {
    return branches.find(b => b.id === id)?.name || id || '-';
  }

  async function startRequest() {
    const roleOk = ['admin','manager','cashier'].includes(roleLower);
    const canRequestNow = roleLower === 'superadmin' || roleOk || grants.includes('add_refunds') || grants.includes('add_distribution_refunds');
    if (!canRequestNow) {
      toast.show('Not authorized to request refunds', { type: 'error' });
      return;
    }
    if (!sale) {
      toast.show('Find a sale first', { type: 'error' });
      return;
    }
    if (images.length < 2) {
      toast.show('Upload at least two images', { type: 'error' });
      return;
    }
    if (!remark.trim()) {
      toast.show('Remark is required', { type: 'error' });
      return;
    }
    let requestedAmount = eligible;
    if (refundType === 'partial') {
      const v = Number(amount);
      if (!Number.isFinite(v) || v <= 0) {
        toast.show('Enter a valid refundable amount', { type: 'error' });
        return;
      }
      if (v > eligible) {
        toast.show('Amount exceeds eligible (total minus tax)', { type: 'error' });
        return;
      }
      requestedAmount = Math.round(v * 100) / 100;
    }
    const restockItems = restock || refundType === 'partial'
      ? (sale.items || []).map((item, index) => {
          const key = `${index}:${item.sku || ''}`;
          const unitIds = Array.isArray(serializedSelections[key]) ? serializedSelections[key] : [];
          const soldUnits = Array.isArray(item.soldUnits) ? item.soldUnits : [];
          const qty = soldUnits.length > 0 ? unitIds.length : Number(item.qty || 0);
          return {
            sku: item.sku,
            productId: item.productId || '',
            variantId: item.variantId || '',
            qty,
            unitIds
          };
        }).filter(item => item.qty > 0)
      : [];
    const payload = {
      saleId: sale.id || sale._id || sale.clientId || '',
      invoiceSerial: sale.invoiceSerial || '',
      receiptNumber: sale.receiptNumber || '',
      branchId: sale.branchId,
      refundArea: isDistributionMode ? 'distribution' : 'retail',
      initiatorName: auth.user?.name || 'unknown',
      initiatorRole: auth.role || '',
      type: refundType,
      requestedAmount,
      remark,
      images,
      restock: refundType === 'full' ? !!restock : false,
      restockItems
    };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: cannot submit refund request', { type: 'error' });
        return;
      }
      const clientId = `offline-refund-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const localPayload = { ...payload, id: clientId, clientId, offline: true, created_at: new Date().toISOString(), status: 'pending_approval' };
      dispatch(createRefundRequest(localPayload));
      try {
        await enqueueHttp({ collection: 'refundrequests', label: 'Refund request', path: '/api/refunds/requests', method: 'POST', body: { ...payload, clientId } });
      } catch (e) {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
    } else {
      const clientId = crypto.randomUUID();
      dispatch(createRefundRequest({ ...payload, clientId }));
      try {
        const saved = await refundsApi.createRequest({ ...payload, clientId });
        if (saved) dispatch(mergeRequests([saved]));
      } catch (e) {
        toast.show('Failed to sync to server', { type: 'error' });
      }
    }
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: 'refund_initiated',
      details: { saleId: sale.id, amount: requestedAmount, type: refundType },
      remark,
      branchId: sale.branchId,
      offline: !navigator.onLine
    }));
    setRemark('');
    setAmount('');
    setImages([]);
    if (navigator.onLine) toast.show('Refund request submitted for approval', { type: 'success' });
  }

  // no approve/reject here; approvals moved to Refund Approvals page

  const allRequests = useMemo(() => {
    const me = auth.user?.name || '';
    const roleLower = String(auth.role || '').toLowerCase();
    let rows = refunds.slice().reverse();
    if (roleLower === 'cashier') {
      rows = rows.filter(r => String(r.initiatorName || '') === me);
    } else if (roleLower === 'manager') {
      rows = rows.filter(r => r.branchId === settings.currentBranchId);
    }
    return rows;
  }, [refunds, auth.user, auth.role, settings.currentBranchId]);

  function onExportCsv() {
    const headers = [
      { key: 'ref', label: 'Ref', value: r => r.invoiceSerial || r.receiptNumber || r.saleId },
      { key: 'initiator', label: 'Initiator', value: r => r.initiatorName || '' },
      { key: 'branch', label: 'Branch', value: r => branchLabel(r.branchId) },
      { key: 'type', label: 'Type', value: r => String(r.type || '').toUpperCase() },
      { key: 'amount', label: 'Amount', value: r => String(r.requestedAmount || 0) },
      { key: 'created', label: 'Created', value: r => new Date(r.created_at).toLocaleString() },
      { key: 'status', label: 'Status', value: r => r.status.replace('_', ' ') },
      { key: 'approver', label: 'Approver', value: r => r.approverName || '' }
    ];
    exportCsv('refund-requests.csv', headers, allRequests);
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
      { key: 'approver', label: 'Approver', value: r => r.approverName || '' }
    ];
    exportTablePdf('Refund Requests', headers, allRequests);
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>{pageTitle}</h1>
        <OfflineQueueIndicator collection="refundrequests" label={isDistributionMode ? 'Distribution refunds queued' : 'Refunds queued'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Refund Requests</div><div style={{ fontSize: 28, fontWeight: 800 }}>{refundSummary.total}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Pending</div><div style={{ fontSize: 28, fontWeight: 800 }}>{refundSummary.pending}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Approved</div><div style={{ fontSize: 28, fontWeight: 800 }}>{refundSummary.approved}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Rejected</div><div style={{ fontSize: 28, fontWeight: 800 }}>{refundSummary.rejected}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Requested Amount</div><div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(refundSummary.totalAmount, settings)}</div></div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
          <label>
            {searchLabel}
            <input className="input" placeholder={searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
        </div>
        {query.trim() && (
          <div style={{ marginTop: 8, color: lookupError ? '#b91c1c' : '#64748b' }}>
            {lookupLoading ? 'Searching sale...' : (sale ? `Found ${sale.invoiceSerial || sale.receiptNumber || sale.id}` : (lookupError || 'Sale not found'))}
          </div>
        )}
        {sale && (
          <div style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{sale.invoiceSerial || sale.receiptNumber || sale.id}</div>
                <div style={{ color: '#64748b' }}>{new Date(sale.created_at).toLocaleString()} • {branchLabel(sale.branchId)}</div>
                <div style={{ marginTop: 4 }}>
                  {sale.items.map((it, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>{it.name}{it.spec ? ` [${it.spec}]` : ''}{it.qty ? ` x${it.qty}` : ''}</div>
                        <div>{formatCurrency((Number(it.price)||0)*(Number(it.qty)||1), settings)}</div>
                      </div>
                      {Array.isArray(it.soldUnits) && it.soldUnits.length > 0 && (
                        <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: '#f8fafc' }}>
                          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Serialized Units</div>
                          <div style={{ display: 'grid', gap: 4 }}>
                            {it.soldUnits.map(unit => {
                              const key = `${i}:${it.sku || ''}`;
                              const checked = (serializedSelections[key] || []).includes(unit.unitId);
                              return (
                                <label key={unit.unitId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={e => setSerializedSelections(prev => {
                                      const current = new Set(prev[key] || []);
                                      if (e.target.checked) current.add(unit.unitId);
                                      else current.delete(unit.unitId);
                                      return { ...prev, [key]: Array.from(current) };
                                    })}
                                  />
                                  <span>{unit.imei || unit.serialNumber || unit.unitId}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 4, color: '#64748b' }}>
                  Total: {formatCurrency(sale.total, settings)} • Tax: {formatCurrency(sale.tax, settings)} • Eligible refund: {formatCurrency(eligible, settings)}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>
                Refund Type
                <select className="select" value={refundType} onChange={e => setRefundType(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 6 }}>
                  <option value="full">Full (total minus tax)</option>
                  <option value="partial">Partial (enter amount)</option>
                </select>
              </label>
              {refundType === 'partial' && (
                <label>
                  Refundable Amount
                  <input className="input" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
                </label>
              )}
            </div>
            <label style={{ display: 'block', marginTop: 12 }}>
              Upload Images (min 2)
              <input className="input" type="file" multiple accept="image/*" onChange={onPickFiles} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            {images.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {images.map((src, i) => (
                  <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                    <img src={src} alt={`img${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                    <button
                      className="btn"
                      onClick={() => removeImage(i)}
                      style={{ position: 'absolute', top: -8, right: -8, borderRadius: '50%', width: 22, height: 22, lineHeight: '20px', padding: 0 }}
                      title="Remove"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{ display: 'block', marginTop: 12 }}>
              Remark
              <input className="input" value={remark} onChange={e => setRemark(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            {refundType === 'full' && (
              <label style={{ display: 'block', marginTop: 12 }}>
                <input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} />
                <span style={{ marginLeft: 8 }}>Restock returned items</span>
              </label>
            )}
            <div style={{ marginTop: 12 }}>
              {(() => {
                return canRequest ? (
                  <button className="btn btn-primary" onClick={startRequest}>{requestButtonLabel}</button>
                ) : null;
              })()}
            </div>
          </div>
        )}
      </div>
      <div className="card">
        <h2 className="section-title">Refund Requests</h2>
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
            </tr>
          </thead>
          <tbody>
            {allRequests.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(r => (
              <tr key={r.id}>
                <td>{r.invoiceSerial || r.receiptNumber || r.saleId}</td>
                <td>{r.initiatorName}</td>
                <td>{branchLabel(r.branchId)}</td>
                <td>{String(r.type || '').toUpperCase()}</td>
                <td>{formatCurrency(r.requestedAmount || 0, settings)}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.status.replace('_',' ')}</td>
                <td>{r.approverName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span>Page {page} of {Math.max(1, Math.ceil(allRequests.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(allRequests.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(allRequests.length / pageSize))}>Next</button>
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
    </div>
  );
}

export default RefundsPage;
