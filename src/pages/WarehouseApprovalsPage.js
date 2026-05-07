import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import { approveOperation, deleteOperation, listOperations, rejectOperation } from '../api/wholesale';
import { findApprovalByReference } from '../api/approvals';
import { formatCurrency } from '../utils/currency';
import Modal from '../components/Modal';
import { confirmDialog, promptDialog } from '../utils/dialogs';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import LoadingDots from '../components/LoadingDots';

function WarehouseApprovalsPage() {
  const toast = useToast();
  const dispatch = useDispatch();
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const [status, setStatus] = useState('pending_director');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [reviewItems, setReviewItems] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const canDirectorApprove = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'director' || grants.includes('approve_warehouse_director');
  const canManagerApprove = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'manager' || grants.includes('approve_warehouse_manager');
  const canViewCost = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_profit') || grants.includes('view_financials');
  function normalizeReviewStatus(value) {
    return String(value || '').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted';
  }
  function maskCostValue(value) {
    return canViewCost ? formatCurrency(Number(value || 0), settings) : '****';
  }

  const branchNameById = useMemo(() => {
    const map = new Map();
    branches.forEach(branch => map.set(branch.id, branch.name || branch.code || branch.id));
    return map;
  }, [branches]);

  const load = useCallback(async (options = {}) => {
    setLoading(true);
    try {
      const result = await listOperations({ operationArea: 'warehouse', status, force: !!options.force, paged: true, page, pageSize });
      const merged = (Array.isArray(result?.rows) ? result.rows : [])
        .filter(row => ['purchase', 'transfer', 'adjustment'].includes(String(row.operationType || '').toLowerCase()))
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setRows(merged);
      setTotal(Number(result?.total || merged.length));
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load warehouse approvals'), { type: 'error' });
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, status, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status]);

  useEffect(() => {
    if (!selectedRow) {
      setReviewItems([]);
      return;
    }
    setReviewItems(
      Array.isArray(selectedRow.items) && selectedRow.items.length > 0
        ? selectedRow.items.map((item, index) => ({
            lineId: item.lineId || `${index + 1}`,
            productId: item.productId,
            qty: Number(item.qty || 0),
            unitIds: Array.isArray(item.unitIds) ? item.unitIds.map(String) : [],
            selectedUnits: Array.isArray(item.selectedUnits) ? item.selectedUnits.map(unit => ({ unitId: unit?.unitId || '', imei: unit?.imei || '', serialNumber: unit?.serialNumber || '' })) : [],
            serializedEntries: Array.isArray(item.serializedEntries) ? item.serializedEntries.map(entry => ({ imei: entry?.imei || '', serialNumber: entry?.serialNumber || '' })) : [],
            status: normalizeReviewStatus(item.status),
            reason: item.reason || '',
            remark: item.remark || ''
          }))
        : [{
            lineId: '1',
            productId: selectedRow.productId,
            qty: Number(selectedRow.qty || 0),
            unitIds: Array.isArray(selectedRow.unitIds) ? selectedRow.unitIds.map(String) : [],
            selectedUnits: Array.isArray(selectedRow.selectedUnits) ? selectedRow.selectedUnits.map(unit => ({ unitId: unit?.unitId || '', imei: unit?.imei || '', serialNumber: unit?.serialNumber || '' })) : [],
            serializedEntries: Array.isArray(selectedRow.serializedEntries) ? selectedRow.serializedEntries.map(entry => ({ imei: entry?.imei || '', serialNumber: entry?.serialNumber || '' })) : [],
            status: 'accepted',
            reason: selectedRow.reason || '',
            remark: selectedRow.remark || ''
          }]
    );
  }, [selectedRow]);

  async function act(row, action) {
    const promptText = action === 'approve' ? 'Approval remark' : 'Rejection reason';
    const remark = await promptDialog(promptText);
    if (!remark || !String(remark).trim()) return;
    setWorkingId(row._id || '');
    const nextStatus = action === 'approve'
      ? (String(row.status || '').toLowerCase() === 'pending_director' ? 'pending_manager' : 'approved')
      : 'rejected';
    const affectedProductIds = Array.from(new Set((Array.isArray(row.items) ? row.items : [{ productId: row.productId }]).map(item => String(item?.productId || '')).filter(Boolean)));
    try {
      const normalizedItems = reviewItems.map(item => ({ ...item, status: normalizeReviewStatus(item.status) }));
      const payload = {
        approverName: auth.user?.name || 'unknown',
        approverRole: auth.role || '',
        remark,
        reason: remark,
        items: normalizedItems
      };
      if (action === 'approve') await approveOperation(row, payload);
      else await rejectOperation(row, payload);
      setRows(prev => prev.filter(item => String(item._id || item.clientId) !== String(row._id || row.clientId)));
      setSelectedRow(null);
      toast.show(
        action === 'approve'
          ? (nextStatus === 'pending_manager' ? 'Warehouse request moved to manager approval' : 'Warehouse request approved')
          : 'Warehouse request rejected',
        { type: 'success' }
      );
      setSyncing(true);
      void Promise.allSettled([
        load({ force: true }),
        action === 'approve' && nextStatus === 'approved' ? refreshAffectedProducts(dispatch, affectedProductIds) : Promise.resolve()
      ]).finally(() => setSyncing(false));
    } catch (e) {
      const msg = String(e?.message || '');
      if (/404|not found|timed out/i.test(msg)) {
        try {
          const approval = await findApprovalByReference('WholesaleOperation', row._id || row.clientId);
          if (approval && String(approval.status || '').toLowerCase() !== String(row.status || '').toLowerCase()) {
            setRows(prev => prev.filter(item => String(item._id || item.clientId) !== String(row._id || row.clientId)));
            setSelectedRow(null);
            setSyncing(true);
            void Promise.allSettled([
              load({ force: true }),
              action === 'approve' && String(approval.status || '').toLowerCase() === 'approved' ? refreshAffectedProducts(dispatch, affectedProductIds) : Promise.resolve()
            ]).finally(() => setSyncing(false));
            toast.show('Warehouse request was processed. List refreshed.', { type: 'success' });
            return;
          }
        } catch {}
        void load({ force: true });
        setSelectedRow(null);
        toast.show('Warehouse request state could not be confirmed. List refreshed.', { type: 'warning' });
      } else {
        toast.show(msg || `Failed to ${action} request`, { type: 'error' });
      }
    } finally {
      setWorkingId('');
    }
  }

  function canAct(row) {
    return (String(row.status || '') === 'pending_director' && canDirectorApprove)
      || (String(row.status || '') === 'pending_manager' && canManagerApprove);
  }

  async function removeRequest(row) {
    const confirmed = await confirmDialog('Delete this stuck warehouse request?');
    if (!confirmed) return;
    setWorkingId(row._id || row.clientId || '');
    try {
      await deleteOperation(row._id || row.clientId);
      setRows(prev => prev.filter(item => String(item._id || item.clientId) !== String(row._id || row.clientId)));
      setSelectedRow(null);
      toast.show('Warehouse request deleted', { type: 'success' });
      void load({ force: true });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete request'), { type: 'error' });
    } finally {
      setWorkingId('');
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Warehouse Approvals</h1>
          <div style={{ color: '#64748b', fontSize: 13 }}>Director and manager reviews for warehouse purchase, transfer, and adjustment requests.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={status === 'pending_director' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('pending_director')}>Pending Director</button>
          <button className={status === 'pending_manager' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('pending_manager')}>Pending Manager</button>
          <button className={status === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('approved')}>Approved</button>
          <button className={status === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('rejected')}>Rejected</button>
          <button className="btn" onClick={load} disabled={loading}>{loading ? <LoadingDots label="Loading warehouse approvals" /> : 'Refresh'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ color: '#64748b', fontSize: 13 }}>Showing {rows.length} of {total} requests</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1}>Previous</button>
          <button className="btn" onClick={() => setPage(p => p + 1)} disabled={loading || page * pageSize >= total}>Next</button>
        </div>
      </div>
      {syncing && (
        <div className="card" style={{ padding: 12 }}>
          <div className="loading-bar" style={{ width: '48%', marginBottom: 8 }} />
          <div style={{ color: '#64748b', fontSize: 13 }}>Synchronizing warehouse approval and stock updates…</div>
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Type</th>
                <th align="left">Product</th>
                <th align="left">Route</th>
                <th align="left">Qty</th>
                <th align="left">Value</th>
                <th align="left">Status</th>
                <th align="left">Initiator</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.map(row => {
                const product = products.find(item => String(item.id) === String(row.productId));
                const route = row.operationType === 'transfer'
                  ? `${branchNameById.get(row.fromBranchId || row.from) || row.fromBranchId || row.from || '—'} (${row.fromInventoryType || 'warehouse'}) → ${branchNameById.get(row.toBranchId || row.to) || row.toBranchId || row.to || '—'} (${row.toInventoryType || 'warehouse'})`
                  : `${branchNameById.get(row.branchId) || row.branchId || '—'} • ${row.operationArea || 'warehouse'}`;
                return (
                  <tr key={row._id || row.clientId} style={{ cursor: 'pointer' }} onClick={() => setSelectedRow(row)}>
                    <td>{row.operationType}</td>
                    <td>{product?.name || row.productId}</td>
                    <td>{route}</td>
                    <td>{Number(row.qty || 0)}</td>
                    <td>{maskCostValue(row.cost || row.requestedAmount || 0)}</td>
                    <td>{row.status}</td>
                    <td>{row.initiatedByName || '—'} {row.initiatedByRole ? `(${row.initiatedByRole})` : ''}</td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>No warehouse approvals found</td></tr>}
              {loading && <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>Loading approvals…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRow && (
        <Modal
          title="Warehouse Approval Review"
          onClose={() => setSelectedRow(null)}
          footer={(
            <>
              <button className="btn" onClick={() => setSelectedRow(null)} disabled={!!workingId}>Close</button>
              {roleLower === 'superadmin' && String(selectedRow.status || '').toLowerCase() !== 'approved' && (
                <button className="btn" onClick={() => removeRequest(selectedRow)} disabled={workingId === (selectedRow._id || selectedRow.clientId)}>Delete Request</button>
              )}
              {canAct(selectedRow) && (
                <>
                  <button className="btn" onClick={() => act(selectedRow, 'reject')} disabled={workingId === (selectedRow._id || selectedRow.clientId)}>{workingId === (selectedRow._id || selectedRow.clientId) ? 'Working…' : 'Reject'}</button>
                  <button className="btn btn-primary" onClick={() => act(selectedRow, 'approve')} disabled={workingId === (selectedRow._id || selectedRow.clientId)}>{workingId === (selectedRow._id || selectedRow.clientId) ? 'Working…' : 'Approve'}</button>
                </>
              )}
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            <div><strong>Type:</strong> {selectedRow.operationType}</div>
            <div><strong>Status:</strong> {selectedRow.status}</div>
            <div><strong>Quantity:</strong> {Number(selectedRow.qty || 0)}</div>
            <div><strong>Value:</strong> {maskCostValue(selectedRow.cost || selectedRow.requestedAmount || 0)}</div>
            <div><strong>Source:</strong> {branchNameById.get(selectedRow.fromBranchId || selectedRow.from || selectedRow.branchId) || selectedRow.fromBranchId || selectedRow.from || selectedRow.branchId || '—'} ({selectedRow.fromInventoryType || 'warehouse'})</div>
            <div><strong>Destination:</strong> {branchNameById.get(selectedRow.toBranchId || selectedRow.to) || selectedRow.toBranchId || selectedRow.to || '—'} ({selectedRow.toInventoryType || selectedRow.fromInventoryType || 'warehouse'})</div>
            <div><strong>Remark:</strong> {selectedRow.remark || '—'}</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Product</th>
                    <th align="left">Qty</th>
                    <th align="left">Units</th>
                    <th align="left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((item, index) => {
                    const product = products.find(row => String(row.id) === String(item.productId));
                    return (
                      <tr key={item.lineId || index}>
                        <td>
                          <div style={{ color: '#111827' }}>{product?.name || item.productId}</div>
                          {Array.isArray(item.selectedUnits) && item.selectedUnits.length > 0 && (
                            <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                              {item.selectedUnits.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ')}
                            </div>
                          )}
                          {Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 && (
                            <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                              {item.serializedEntries.map(unit => unit.imei || unit.serialNumber).filter(Boolean).join(', ')}
                            </div>
                          )}
                        </td>
                        <td><input className="input" type="number" min="0" value={item.qty} onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Number(e.target.value) || 0 } : row))} style={{ width: 90, color: '#111827' }} disabled={(Array.isArray(item.unitIds) && item.unitIds.length > 0) || (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0) || !canAct(selectedRow) || !!workingId} /></td>
                        <td style={{ color: '#111827' }}>{Array.isArray(item.unitIds) && item.unitIds.length > 0 ? item.unitIds.length : (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 ? item.serializedEntries.length : '—')}</td>
                        <td>
                          <select className="select" value={normalizeReviewStatus(item.status)} onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, status: e.target.value } : row))} style={{ color: '#111827' }} disabled={!canAct(selectedRow) || !!workingId}>
                            <option value="accepted">Accepted</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default WarehouseApprovalsPage;
