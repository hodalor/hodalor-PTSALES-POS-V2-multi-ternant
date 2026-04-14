import { NavLink, useLocation } from 'react-router-dom';

const titles = {
  'dashboard': 'Dashboard',
  'pos': 'POS',
  'sales': 'Sales',
  'products': 'Products',
  'inventory': 'Inventory',
  'purchases': 'Purchases',
  'transfers': 'Transfers',
  'adjustments': 'Adjustments',
  'suppliers': 'Suppliers',
  'customers': 'Customers',
  'refunds': 'Refunds',
  'reports': 'Reports',
  'users': 'Users',
  'cashdrawer': 'Cash Drawer',
  'config': 'Config'
};

function cap(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const crumbs = [{ path: '/dashboard', label: 'Dashboard' }].concat(
    parts.map((p, i) => {
      const path = '/' + parts.slice(0, i + 1).join('/');
      const key = p.toLowerCase();
      const label = titles[key] || cap(p);
      return { path, label };
    })
  );
  const dedup = [];
  for (let i = 0; i < crumbs.length; i++) {
    if (!dedup.length || dedup[dedup.length - 1].path !== crumbs[i].path) dedup.push(crumbs[i]);
  }
  const lastIndex = dedup.length - 1;
  return (
    <div className="breadcrumbs">
      <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16, marginRight: 4 }}>
        <path d="M3 10l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2v-9z" stroke="currentColor" strokeWidth="2" />
      </svg>
      {dedup.map((c, idx) => (
        <span key={c.path}>
          {idx < lastIndex ? (
            <>
              <NavLink to={c.path}>{c.label}</NavLink>
              <span className="crumb-sep">›</span>
            </>
          ) : (
            <span className="crumb-current">{c.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export default Breadcrumbs;
