import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { isOfflineBackupEnabled } from '../offline/offlineBackup';

function OfflineQueueIndicator({ collection, label }) {
  const settings = useSelector(s => s.settings);
  const summary = useSelector(s => s.offlineQueue);
  const enabled = isOfflineBackupEnabled(settings);
  const byCollection = summary && summary.byCollection ? summary.byCollection : {};
  const count = collection ? Number(byCollection?.[collection] || 0) : Number(summary?.total || 0);
  if (!enabled || !Number.isFinite(count) || count <= 0) return null;
  const text = label ? `${label}: ${count}` : `Offline queued: ${count}`;
  return (
    <Link
      to="/backup"
      className="btn"
      style={{
        minWidth: 22,
        height: 32,
        borderRadius: 999,
        padding: '0 10px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ef4444',
        color: '#fff',
        fontWeight: 800,
        fontSize: 12,
        textDecoration: 'none'
      }}
    >
      {text}
    </Link>
  );
}

export default OfflineQueueIndicator;

