import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useMemo, useState } from 'react';
import { setSession, openSession, closeSession, addMovement } from '../store/sessionsSlice';
import { downloadText, escposOpenDrawer } from '../utils/escpos';
import * as cashApi from '../api/cashsessions';
import { formatCurrency } from '../utils/currency';
import { useToast } from '../components/ToastProvider';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import InlineSpinner from '../components/InlineSpinner';

function CashDrawerPage() {
  const dispatch = useDispatch();
  const session = useSelector(s => s.sessions);
  const settings = useSelector(s => s.settings);
  const toast = useToast();
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const [floatAmount, setFloatAmount] = useState(0);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loadingSession, setLoadingSession] = useState(false);
  const [workingAction, setWorkingAction] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingSession(true);
      try {
        const me = await cashApi.me();
        if (alive && me && typeof me === 'object') dispatch(setSession(me));
      } catch {}
      finally {
        if (alive) setLoadingSession(false);
      }
    })();
    return () => { alive = false; };
  }, [dispatch]);

  function openDrawer() {
    (async () => {
      setWorkingAction('open');
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        dispatch(openSession(Number(floatAmount)));
        try {
          await enqueueHttp({ collection: 'cashsessions', label: 'Cash session open', path: '/api/cashsessions/open', method: 'POST', body: { openingFloat: Number(floatAmount) } });
          toast.show('Saved offline. Will backup when online.', { type: 'success' });
        } catch {
          toast.show('Failed to save offline', { type: 'error' });
        }
        return;
      }
      try {
        const doc = await cashApi.open(Number(floatAmount));
        dispatch(setSession(doc));
      } catch {
        toast.show('Failed to open session on server', { type: 'error' });
      } finally {
        setWorkingAction('');
      }
    })();
  }
  function openDrawerNow() {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadText(`drawer-open-${ts}.txt`, escposOpenDrawer());
  }
  function record(type) {
    if (!amount) return;
    (async () => {
      setWorkingAction(type);
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        dispatch(addMovement({ type, amount: Number(amount), note }));
        try {
          await enqueueHttp({ collection: 'cashsessions', label: 'Cash session move', path: '/api/cashsessions/move', method: 'POST', body: { type, amount: Number(amount), note } });
          toast.show('Saved offline. Will backup when online.', { type: 'success' });
        } catch {
          toast.show('Failed to save offline', { type: 'error' });
        } finally {
          setAmount('');
          setNote('');
        }
        return;
      }
      try {
        const doc = await cashApi.move(type, Number(amount), note);
        dispatch(setSession(doc));
      } catch {
        toast.show('Failed to record movement on server', { type: 'error' });
      } finally {
        setAmount('');
        setNote('');
        setWorkingAction('');
      }
    })();
  }
  const totalIn = session.movements.filter(m => m.type === 'in').reduce((s, m) => s + m.amount, 0);
  const totalOut = session.movements.filter(m => m.type === 'out').reduce((s, m) => s + m.amount, 0);
  const expected = session.openingFloat + totalIn - totalOut;
  const summaryCards = useMemo(() => ([
    { key: 'opened', label: 'Opening Float', value: formatCurrency(session.openingFloat || 0, settings), accent: '#2563eb' },
    { key: 'expected', label: 'Expected Cash', value: formatCurrency(expected || 0, settings), accent: '#0f766e' },
    { key: 'cashin', label: 'Cash In', value: formatCurrency(totalIn || 0, settings), accent: '#7c3aed' },
    { key: 'cashout', label: 'Cash Out', value: formatCurrency(totalOut || 0, settings), accent: '#dc2626' }
  ]), [expected, session.openingFloat, settings, totalIn, totalOut]);

  return (
    <div className="sales-page-shell">
      <div className="sales-header">
        <div className="sales-header-copy">
          <div className="ui-eyebrow">Till Control</div>
          <h1 className="sales-title">Cash Drawer</h1>
          <p className="sales-subtitle">Open the till, record cash movements, and close the session with a cleaner cashier workflow.</p>
        </div>
        <div className="sales-header-actions">
          <OfflineQueueIndicator collection="cashsessions" label="Cash queued" />
        </div>
      </div>
      {loadingSession && (
        <div className="sales-section-card" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <InlineSpinner />
          <span style={{ color: '#64748b' }}>Loading cash session…</span>
        </div>
      )}
      {session.isOpen ? (
        <>
          <div className="sales-summary-grid">
            {summaryCards.map((card) => (
              <div key={card.key} className="sales-summary-card" style={{ '--accent': card.accent }}>
                <div className="sales-summary-label">{card.label}</div>
                <div className="sales-summary-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="sales-section-card">
            <div className="sales-section-head">
              <div>
                <h2 className="sales-section-title">Live Session</h2>
                <p className="sales-section-note">{session.openedAt ? `Opened ${new Date(session.openedAt).toLocaleString()}` : 'Session is active.'}</p>
              </div>
            </div>
            <div className="cashdrawer-action-row">
              <input className="input" placeholder="Amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
              <input className="input" placeholder="Note" value={note} onChange={e => setNote(e.target.value)} />
              <button className="btn btn-primary" onClick={() => record('in')} disabled={workingAction === 'in' || workingAction === 'out' || workingAction === 'close'}>
              {workingAction === 'in' ? 'Processing…' : 'Cash In'}
              </button>
              <button className="btn" onClick={() => record('out')} disabled={workingAction === 'in' || workingAction === 'out' || workingAction === 'close'}>
              {workingAction === 'out' ? 'Processing…' : 'Cash Out'}
              </button>
              <button className="btn" onClick={openDrawerNow}>Open Drawer Now</button>
            </div>
          </div>

          <div className="sales-section-card">
            <div className="sales-section-head">
              <div>
                <h2 className="sales-section-title">Movements</h2>
                <p className="sales-section-note">Track everything added to or removed from the till during this session.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Time</th>
                    <th align="left">Type</th>
                    <th align="left">Amount</th>
                    <th align="left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {session.movements.map((m, i) => (
                    <tr key={i}>
                      <td>{new Date(m.time).toLocaleString()}</td>
                      <td><span className={`status-badge ${m.type === 'in' ? 'success' : 'danger'}`}>{m.type}</span></td>
                      <td>{formatCurrency(m.amount, settings)}</td>
                      <td>{m.note || '—'}</td>
                    </tr>
                  ))}
                  {session.movements.length === 0 && (
                    <tr><td colSpan={4} style={{ color: '#64748b' }}>No movements recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="sales-table-meta">
              <div className="sales-results-note">Close the session when reconciliation is complete.</div>
              <button className="btn btn-primary" onClick={() => {
              (async () => {
                setWorkingAction('close');
                if (!navigator.onLine) {
                  if (!offlineBackupAllowed) {
                    toast.show('Offline: connect internet and try again.', { type: 'error' });
                    return;
                  }
                  dispatch(closeSession());
                  try {
                    await enqueueHttp({ collection: 'cashsessions', label: 'Cash session close', path: '/api/cashsessions/close', method: 'POST', body: {} });
                    toast.show('Saved offline. Will backup when online.', { type: 'success' });
                  } catch {
                    toast.show('Failed to save offline', { type: 'error' });
                  }
                  return;
                }
                try {
                  const doc = await cashApi.close();
                  dispatch(setSession(doc));
                } catch {
                  toast.show('Failed to close session on server', { type: 'error' });
                } finally {
                  setWorkingAction('');
                }
              })();
            }} disabled={workingAction === 'in' || workingAction === 'out' || workingAction === 'close'}>
              {workingAction === 'close' ? 'Closing…' : 'Close Session'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="sales-section-card cashdrawer-open-card">
          <div className="sales-section-head">
            <div>
              <h2 className="sales-section-title">Open Cash Drawer</h2>
              <p className="sales-section-note">Start the cashier session with the opening float before sales begin.</p>
            </div>
          </div>
          <input className="input" placeholder="Opening float" type="number" value={floatAmount} onChange={e => setFloatAmount(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 10 }} />
          <div className="cashdrawer-open-actions">
            <button className="btn btn-primary" onClick={openDrawer} disabled={workingAction === 'open'}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {workingAction === 'open' && <InlineSpinner />}
              {workingAction === 'open' ? 'Opening…' : 'Open Session'}
              </span>
            </button>
            <button className="btn" onClick={openDrawerNow}>Open Drawer Now</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CashDrawerPage;
