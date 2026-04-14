import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { approveApproval, listApprovals, rejectApproval } from '../api/approvals';
import { listRepayments, removeRepayment } from '../api/credits';
import { useToast } from '../components/ToastProvider';
import { confirmDialog, promptDialog } from '../utils/dialogs';
import Modal from '../components/Modal';
import InlineSpinner from '../components/InlineSpinner';

function EasyBuyRepaymentApprovalsPage() {
  const toast = useToast();
  const auth = useSelector(s => s.auth);
  const canDeleteRepayments = String(auth.role || '').toLowerCase() === 'superadmin';
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending_director');
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [repaymentsById, setRepaymentsById] = useState({});
  const [selectedRow, setSelectedRow] = useState(null);
  const [deletingId, setDeletingId] = useState('');

  const loadRepayments = useCallback(async () => {
    try {
      const repayments = await listRepayments({});
      const map = Object.fromEntries((Array.isArray(repayments) ? repayments : []).map(row => [String(row._id), row]));
      setRepaymentsById(map);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listApprovals(status === 'all' ? { actionType: 'credit_repayment' } : { actionType: 'credit_repayment', status });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load repayment approvals'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [status, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRepayments(); }, [loadRepayments]);

  async function onApprove(row) {
    const remark = await promptDialog('Approval remark');
    if (!remark || !String(remark).trim()) return;
    setWorkingId(row._id || '');
    try {
      await approveApproval(row._id, { remark, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '' });
      setRows(prev => prev.filter(item => String(item._id) !== String(row._id)));
      toast.show('Repayment approval updated', { type: 'success' });
      void load();
      void loadRepayments();
    } catch (e) {
      const msg = String(e?.message || '');
      if (/timed out/i.test(msg)) {
        void load();
        void loadRepayments();
        toast.show('Approval is processing. The list has been refreshed.', { type: 'success' });
      } else {
        toast.show(msg || 'Failed to approve', { type: 'error' });
      }
    } finally {
      setWorkingId('');
    }
  }

  async function onReject(row) {
    const reason = await promptDialog('Rejection reason');
    if (!reason || !String(reason).trim()) return;
    setWorkingId(row._id || '');
    try {
      await rejectApproval(row._id, { reason, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '' });
      setRows(prev => prev.filter(item => String(item._id) !== String(row._id)));
      toast.show('Repayment approval rejected', { type: 'success' });
      void load();
      void loadRepayments();
    } catch (e) {
      const msg = String(e?.message || '');
      if (/timed out/i.test(msg)) {
        void load();
        void loadRepayments();
        toast.show('Rejection is processing. The list has been refreshed.', { type: 'success' });
      } else {
        toast.show(msg || 'Failed to reject', { type: 'error' });
      }
    } finally {
      setWorkingId('');
    }
  }

  async function onDelete(row) {
    const repaymentId = String(row.referenceId || '');
    if (!repaymentId) return;
    const ok = await confirmDialog('Delete this repayment request?');
    if (!ok) return;
    setDeletingId(repaymentId);
    try {
      await removeRepayment(repaymentId);
      setRows(prev => prev.filter(item => String(item._id) !== String(row._id)));
      setRepaymentsById(prev => {
        const next = { ...prev };
        delete next[repaymentId];
        return next;
      });
      toast.show('Repayment request deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete repayment request'), { type: 'error' });
    } finally {
      setDeletingId('');
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Credit Sale Repayment Approvals</h1>
          <div style={{ color: '#64748b', fontSize: 13 }}>Director and manager approvals for repayment requests.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={status === 'pending_director' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('pending_director')}>Pending Director</button>
          <button className={status === 'pending_manager' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('pending_manager')}>Pending Manager</button>
          <button className={status === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('approved')}>Approved</button>
          <button className={status === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatus('rejected')}>Rejected</button>
        </div>
      </div>
      <div className="card">
        {loading && <div style={{ padding: 12, color: '#64748b' }}>Loading approvals…</div>}
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Action</th>
                <th align="left">Status</th>
                <th align="left">Amount</th>
                <th align="left">Remark</th>
                <th align="left">Initiated By</th>
                <th align="left">Created</th>
                <th align="left"></th>
                {canDeleteRepayments && <th align="left"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const repayment = repaymentsById[String(row.referenceId)] || null;
                return (
                <tr key={row._id} onClick={() => setSelectedRow(row)} style={{ cursor: 'pointer', opacity: deletingId === String(row.referenceId || '') ? 0.55 : 1 }}>
                  <td>{row.actionType}</td>
                  <td>{row.status}</td>
                  <td>{repayment ? `K${Number(repayment.amount || 0).toFixed(2)}` : '—'}</td>
                  <td>{repayment?.remark || row.managerRemark || row.directorRemark || '—'}</td>
                  <td>{row.initiatedByName || '—'} {row.initiatedByRole ? `(${row.initiatedByRole})` : ''}</td>
                  <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                  <td>
                    {(row.status === 'pending_director' || row.status === 'pending_manager') ? (
                      <>
                        <button className="btn btn-primary" onClick={e => { e.stopPropagation(); onApprove(row); }} disabled={workingId === row._id}>{workingId === row._id ? 'Working…' : 'Approve'}</button>
                        <button className="btn" onClick={e => { e.stopPropagation(); onReject(row); }} disabled={workingId === row._id} style={{ marginLeft: 6 }}>{workingId === row._id ? 'Working…' : 'Reject'}</button>
                      </>
                    ) : '—'}
                  </td>
                  {canDeleteRepayments && (
                    <td>
                      <button className="btn" onClick={e => { e.stopPropagation(); void onDelete(row); }} disabled={deletingId === String(row.referenceId || '')}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {deletingId === String(row.referenceId || '') && <InlineSpinner />}
                          {deletingId === String(row.referenceId || '') ? 'Deleting…' : 'Delete'}
                        </span>
                      </button>
                    </td>
                  )}
                </tr>
              )})}
              {!loading && rows.length === 0 && <tr><td colSpan={canDeleteRepayments ? 8 : 7} style={{ padding: 12, color: '#64748b' }}>No repayment approvals found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {selectedRow && (
        <Modal
          title="Repayment Approval Details"
          onClose={() => setSelectedRow(null)}
          footer={<button className="btn" onClick={() => setSelectedRow(null)}>Close</button>}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            {(() => {
              const repayment = repaymentsById[String(selectedRow.referenceId)] || null;
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <div><strong>Status:</strong> <span style={{ color: '#111827' }}>{selectedRow.status}</span></div>
                    <div><strong>Amount:</strong> <span style={{ color: '#111827' }}>{repayment ? `K${Number(repayment.amount || 0).toFixed(2)}` : '—'}</span></div>
                    <div><strong>Initiator:</strong> <span style={{ color: '#111827' }}>{selectedRow.initiatedByName || '—'} {selectedRow.initiatedByRole ? `(${selectedRow.initiatedByRole})` : ''}</span></div>
                    <div><strong>Created:</strong> <span style={{ color: '#111827' }}>{selectedRow.createdAt ? new Date(selectedRow.createdAt).toLocaleString() : '—'}</span></div>
                  </div>
                  <div><strong>Remark:</strong> <span style={{ color: '#111827' }}>{repayment?.remark || '—'}</span></div>
                  <div><strong>Credit Sale ID:</strong> <span style={{ color: '#111827' }}>{repayment?.creditSaleId || '—'}</span></div>
                  <div><strong>Director Remark:</strong> <span style={{ color: '#111827' }}>{selectedRow.directorRemark || '—'}</span></div>
                  <div><strong>Manager Remark:</strong> <span style={{ color: '#111827' }}>{selectedRow.managerRemark || '—'}</span></div>
                </>
              );
            })()}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default EasyBuyRepaymentApprovalsPage;
