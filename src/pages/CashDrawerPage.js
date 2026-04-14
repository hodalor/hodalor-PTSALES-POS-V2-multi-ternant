import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useState } from 'react';
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

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Cash Drawer</h1>
        <OfflineQueueIndicator collection="cashsessions" label="Cash queued" />
      </div>
      {loadingSession && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <InlineSpinner />
          <span style={{ color: '#64748b' }}>Loading cash session…</span>
        </div>
      )}
      {session.isOpen ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
            <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
              <div style={{ color: '#64748b' }}>Opened</div>
              <div style={{ fontWeight: 700 }}>{new Date(session.openedAt).toLocaleString()}</div>
            </div>
            <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
              <div style={{ color: '#64748b' }}>Opening Float</div>
              <div style={{ fontWeight: 700 }}>{formatCurrency(session.openingFloat, settings)}</div>
            </div>
            <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
              <div style={{ color: '#64748b' }}>Expected Cash</div>
              <div style={{ fontWeight: 700 }}>{formatCurrency(expected, settings)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input placeholder="amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            <input placeholder="note" value={note} onChange={e => setNote(e.target.value)} />
            <button onClick={() => record('in')} disabled={workingAction === 'in' || workingAction === 'out' || workingAction === 'close'}>
              {workingAction === 'in' ? 'Processing…' : 'Cash In'}
            </button>
            <button onClick={() => record('out')} disabled={workingAction === 'in' || workingAction === 'out' || workingAction === 'close'}>
              {workingAction === 'out' ? 'Processing…' : 'Cash Out'}
            </button>
            <button onClick={openDrawerNow}>Open Drawer Now</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td>{new Date(m.time).toLocaleString()}</td>
                  <td>{m.type}</td>
                  <td>{formatCurrency(m.amount, settings)}</td>
                  <td>{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => {
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
        </>
      ) : (
        <div style={{ background: '#fff', padding: 16, borderRadius: 12, width: 360 }}>
          <h2>Open Cash Drawer</h2>
          <input placeholder="Opening float" type="number" value={floatAmount} onChange={e => setFloatAmount(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }} />
          <button onClick={openDrawer} disabled={workingAction === 'open'}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {workingAction === 'open' && <InlineSpinner />}
              {workingAction === 'open' ? 'Opening…' : 'Open Session'}
            </span>
          </button>
          <div style={{ marginTop: 8 }}>
            <button onClick={openDrawerNow}>Open Drawer Now</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CashDrawerPage;
