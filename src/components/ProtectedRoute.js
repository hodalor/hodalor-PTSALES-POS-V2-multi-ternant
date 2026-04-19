import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router-dom';
import { isFeatureEnabled } from '../utils/featureFlags';

function ProtectedRoute({ roles, grant, feature, children }) {
  const auth = useSelector(state => state.auth);
  const settings = useSelector(state => state.settings);
  const location = useLocation();
  if (!auth.initialized) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading…</div>;
  }
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  const expiryTs = settings?.subscriptionExpiresAt ? new Date(settings.subscriptionExpiresAt).getTime() : 0;
  const isPermanent = !!settings?.subscriptionPermanent;
  const isSuper = String(auth.role || '').toLowerCase() === 'superadmin' && String(auth.user?.tenantId || '').toLowerCase() === 'master';
  if (!isSuper && !settings?.hydrated) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading tenant access…</div>;
  }
  if (!isSuper && !isPermanent && expiryTs && expiryTs < Date.now()) {
    return (
      <div style={{ padding: 24, display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#991b1b' }}>Subscription Expired</div>
        <div style={{ color: '#475569' }}>
          This tenant subscription has expired. Please contact the super admin to renew access.
        </div>
      </div>
    );
  }
  if (!isSuper && feature && !isFeatureEnabled(settings, feature)) {
    const fallback = location.pathname === '/pos' ? '/dashboard' : '/pos';
    return <Navigate to={fallback} replace />;
  }
  const grantFeatureEnabled = (g) => {
    const key = `grants.${String(g || '')}`;
    return settings?.featureFlags?.[key] !== false;
  };
  if (!isSuper && grant) {
    const requested = Array.isArray(grant) ? grant : [grant];
    if (!requested.some(grantFeatureEnabled)) {
      return <Navigate to="/dashboard" replace />;
    }
  }
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  function has(g) {
    if (!g) return false;
    if (grants.includes(g)) return true;
    if (g.startsWith('view_')) return grants.includes(`see_${g.slice(5)}`);
    if (g.startsWith('see_')) return grants.includes(`view_${g.slice(4)}`);
    return false;
  }
  const hasGrant = Array.isArray(grant) ? grant.some(has) : has(grant);
  const roleLower = String(auth.role || '').toLowerCase();
  const roleAllowed = roles && roles.length > 0 && roles.indexOf(auth.role) !== -1;
  const enforceGrantForRole = grant && !['superadmin', 'admin'].includes(roleLower);
  if (!isSuper && enforceGrantForRole && !hasGrant) {
    return <Navigate to="/pos" replace />;
  }
  if (!isSuper && !enforceGrantForRole && !hasGrant && roles && roles.length > 0 && !roleAllowed) {
    return <Navigate to="/pos" replace />;
  }
  return children;
}

export default ProtectedRoute;
