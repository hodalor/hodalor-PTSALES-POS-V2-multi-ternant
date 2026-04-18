import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import LoginPage from './pages/LoginPage';
import PosPage from './pages/PosPage';
import ProductsPage from './pages/ProductsPage';
import InventoryPage from './pages/InventoryPage';
import SerializedInventoryPage from './pages/SerializedInventoryPage';
import ReportsPage from './pages/ReportsPage';
import NotFoundPage from './pages/NotFoundPage';
import ProtectedRoute from './components/ProtectedRoute';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as productsApi from './api/products';
import * as suppliersApi from './api/suppliers';
import * as customersApi from './api/customers';
import { loadState, clearTenantState } from './store/persist';
import { filterGrantsByTenantFlags } from './utils/tenantAccess';
import { isFeatureEnabled } from './utils/featureFlags';
import * as branchesApi from './api/branches';
import { setProducts } from './store/productsSlice';
import { setSuppliers } from './store/suppliersSlice';
import { setCustomers } from './store/customersSlice';
import { setBranches } from './store/branchesSlice';
import * as refundsApi from './api/refunds';
import * as purchasesApi from './api/purchases';
import * as transfersApi from './api/transfers';
import * as salesApi from './api/sales';
import { setRequests } from './store/refundsSlice';
import { setSales } from './store/salesSlice';
import CustomersPage from './pages/CustomersPage';
import RefundsPage from './pages/RefundsPage';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import ConfigSettingsPage from './pages/ConfigSettingsPage';
import UsersPage from './pages/UsersPage';
import PurchasesPage from './pages/PurchasesPage';
import TransfersPage from './pages/TransfersPage';
import AdjustmentsPage from './pages/AdjustmentsPage';
import SuppliersPage from './pages/SuppliersPage';
import SalesPage from './pages/SalesPage';
import CashDrawerPage from './pages/CashDrawerPage';
import RefundApprovalsPage from './pages/RefundApprovalsPage';
import ApprovalsPage from './pages/ApprovalsPage';
import CreditControlPage from './pages/CreditControlPage';
import EasyBuyGoodClientsPage from './pages/EasyBuyGoodClientsPage';
import EasyBuyDefaultersPage from './pages/EasyBuyDefaultersPage';
import EasyBuyRepaymentApprovalsPage from './pages/EasyBuyRepaymentApprovalsPage';
import WholesalePurchasePage from './pages/WholesalePurchasePage';
import WholesaleTransferPage from './pages/WholesaleTransferPage';
import WholesaleAdjustmentPage from './pages/WholesaleAdjustmentPage';
import WholesaleRefundPage from './pages/WholesaleRefundPage';
import WholesaleGoodsPage from './pages/WholesaleGoodsPage';
import WarehousePurchasePage from './pages/WarehousePurchasePage';
import WarehouseTransferPage from './pages/WarehouseTransferPage';
import WarehouseAdjustmentPage from './pages/WarehouseAdjustmentPage';
import WarehouseApprovalsPage from './pages/WarehouseApprovalsPage';
import WarehouseGoodsPage from './pages/WarehouseGoodsPage';
import ToastProvider from './components/ToastProvider';
import LabelsPage from './pages/LabelsPage';
import AuditLogPage from './pages/AuditLogPage';
import ReceiptPublicPage from './pages/ReceiptPublicPage';
import AdminManualPage from './pages/AdminManualPage';
import DocsPage from './pages/DocsPage';
import StockRecordsPage from './pages/StockRecordsPage';
import ServerLogsPage from './pages/ServerLogsPage';
import ExpensesPage from './pages/ExpensesPage';
import ExpenseApprovalsPage from './pages/ExpenseApprovalsPage';
import GodHandPage from './pages/GodHandPage';
import BackupPage from './pages/BackupPage';
import ImeiConflictsPage from './pages/ImeiConflictsPage';
import InvoicesPage from './pages/InvoicesPage';
import WholesaleInvoicesPage from './pages/WholesaleInvoicesPage';
import WarehouseInvoicesPage from './pages/WarehouseInvoicesPage';
import TenantsPage from './pages/TenantsPage';
import * as authApi from './api/auth';
import { resetTenantAppState } from './store';
import * as tenantsApi from './api/tenants';
import { loginSuccess, setGrants, setInitialized, logout } from './store/authSlice';
import * as settingsApi from './api/settings';
import { setAllSettings } from './store/settingsSlice';
import * as usersApi from './api/users';
import { setUsers } from './store/usersSlice';
import * as auditsApi from './api/audits';
import * as invoicesApi from './api/invoices';
import * as adjustmentsApi from './api/adjustments';
import * as expensesApi from './api/expenses';
import { setEntries as setAuditEntries } from './store/auditSlice';
import { setInvoices } from './store/invoicesSlice';
import { ensureOnlineJwt } from './offline/reAuth';

function App() {
  const dispatch = useDispatch();
  const refreshSec = useSelector(s => s.settings.refreshIntervalSec || 60);
  const isAuthed = useSelector(s => s.auth.isAuthenticated);
  const settings = useSelector(s => s.settings);
  const userName = useSelector(s => s.auth.user?.name || '');
  const isAuthedNow = useSelector(s => s.auth.isAuthenticated);
  const authTenantId = useSelector(s => s.auth.user?.tenantId || '');
  const authRole = useSelector(s => s.auth.role || '');
  const authGrants = useSelector(s => s.auth.grants || []);
  const clientAppName = settings?.clientAppName;
  const appName = settings?.appName;
  const clientLogoUrl = settings?.clientLogoUrl;
  const themeColor = settings?.themeColor || '#0b1220';
  const [settingsReady, setSettingsReady] = useState(false);
  useEffect(() => {
    function resizeToPng(src, size) {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, size, size);
          const iw = img.width || size;
          const ih = img.height || size;
          const scale = Math.min(size / iw, size / ih);
          const dw = Math.max(1, Math.floor(iw * scale));
          const dh = Math.max(1, Math.floor(ih * scale));
          const dx = Math.floor((size - dw) / 2);
          const dy = Math.floor((size - dh) / 2);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, dx, dy, dw, dh);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }
    async function regen() {
      const branded = clientAppName || appName || 'ptSales POS';
      const shortName = branded.length > 12 ? branded.slice(0, 12) : branded;
      let icon192 = 'logo192.png';
      let icon512 = 'logo512.png';
      const src = clientLogoUrl || '';
      if (src && typeof src === 'string' && src.startsWith('data:')) {
        const r192 = await resizeToPng(src, 192);
        const r512 = await resizeToPng(src, 512);
        if (r192) icon192 = r192;
        if (r512) icon512 = r512;
      }
      const manifest = {
        short_name: shortName,
        name: branded,
        icons: [
          { src: icon192, type: icon192.startsWith('data:') ? 'image/png' : 'image/png', sizes: '192x192', purpose: 'any maskable' },
          { src: icon512, type: icon512.startsWith('data:') ? 'image/png' : 'image/png', sizes: '512x512', purpose: 'any maskable' }
        ],
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: themeColor,
        background_color: '#0b1220',
        orientation: 'portrait',
        categories: ['business', 'finance', 'productivity']
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
      const url = URL.createObjectURL(blob);
      let link = document.querySelector('link[rel="manifest"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'manifest';
        document.head.appendChild(link);
      }
      const prev = link.getAttribute('href');
      link.setAttribute('href', url);
      if (prev && prev.startsWith('blob:')) {
        try { URL.revokeObjectURL(prev); } catch {}
      }
      let meta = document.querySelector('meta[name="application-name"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'application-name');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', branded);
      document.title = branded;
      let themeMeta = document.querySelector('meta[name="theme-color"]');
      if (!themeMeta) {
        themeMeta = document.createElement('meta');
        themeMeta.setAttribute('name', 'theme-color');
        document.head.appendChild(themeMeta);
      }
      themeMeta.setAttribute('content', themeColor);
      let apple = document.querySelector('link[rel="apple-touch-icon"]');
      if (!apple) {
        apple = document.createElement('link');
        apple.rel = 'apple-touch-icon';
        document.head.appendChild(apple);
      }
      apple.setAttribute('href', icon192);
    }
    regen();
  }, [clientAppName, appName, clientLogoUrl, themeColor]);
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('ptSales:authToken');
        if (token && String(token).toLowerCase() !== 'offline') {
          const resp = await authApi.me();
          if (resp && resp.role) {
            dispatch(loginSuccess({ user: resp.user, role: resp.role, grants: resp.grants || [] }));
          }
        } else if (!token) {
          dispatch(logout());
        }
      } catch {
        const tenantId = String(localStorage.getItem('ptSales:tenantId') || 'default');
        try { if (navigator.onLine) await authApi.logout(); } catch {}
        try { localStorage.removeItem('ptSales:authToken'); } catch {}
        dispatch(resetTenantAppState(tenantId));
        dispatch(logout());
      } finally {
        dispatch(setInitialized(true));
      }
    })();
  }, [dispatch]);
  useEffect(() => {
    const tid = setTimeout(() => {
      dispatch(setInitialized(true));
    }, 3000);
    return () => clearTimeout(tid);
  }, [dispatch]);
  useEffect(() => {
    if (!isAuthed) {
      setSettingsReady(false);
      return;
    }
    (async () => {
      if (!isAuthed) return;
      try {
        const isMaster = String(authTenantId || '').toLowerCase() === 'master';
        const meta = await tenantsApi.me().catch(() => ({}));
        const remote = await settingsApi.get();
        if ((remote && Object.keys(remote).length > 0) || (!isMaster && meta && typeof meta === 'object')) {
          const mergedBase = isMaster
            ? (remote || {})
            : {
                ...(remote || {}),
                clientAppName: remote?.clientAppName || meta?.clientAppName || meta?.name || '',
                clientLogoUrl: remote?.clientLogoUrl || meta?.logo || '',
                themeColor: remote?.themeColor || meta?.themeColor || '',
                subscriptionPlan: remote?.subscriptionPlan || meta?.subscriptionPlan || 'basic',
                subscriptionExpiresAt: remote?.subscriptionExpiresAt || meta?.subscriptionExpiresAt || null,
                subscriptionPermanent: remote?.subscriptionPermanent ?? meta?.subscriptionPermanent ?? false
              };
          const merged = {
            ...mergedBase,
            taxRate: Number.isFinite(Number(mergedBase?.taxRate)) ? Math.max(0, Math.min(1, Number(mergedBase.taxRate))) : 0
          };
          dispatch(setAllSettings(merged));
          try {
            const root = document.documentElement;
            const color = !isMaster ? String(merged.themeColor || '') : '';
            if (color) {
              root.style.setProperty('--brand', color);
              root.style.setProperty('--sidebar-bg', color);
              root.style.setProperty('--active', color);
            } else {
              root.style.removeProperty('--brand');
              root.style.removeProperty('--sidebar-bg');
              root.style.removeProperty('--active');
            }
          } catch {}
        } else {
          dispatch(setAllSettings({
            clientAppName: '',
            clientLogoUrl: '',
            themeColor: '',
            subscriptionPlan: 'enterprise',
            subscriptionExpiresAt: null,
            subscriptionPermanent: false
          }));
          try {
            const root = document.documentElement;
            root.style.removeProperty('--brand');
            root.style.removeProperty('--sidebar-bg');
            root.style.removeProperty('--active');
          } catch {}
          const snapshot = loadState();
          const localDefaults = snapshot?.settings || {};
          if (Object.keys(localDefaults).length > 0) {
            await settingsApi.save(localDefaults);
          }
        }
      } catch (e) {
        console.error('Settings init error:', e);
      } finally {
        setSettingsReady(true);
      }
    })();
  }, [dispatch, isAuthed, authTenantId]);
  useEffect(() => {
    (async () => {
      if (!isAuthed || !settingsReady) return;
      try {
        const migFlag = localStorage.getItem(`ptSales:migratedDbV1:${String(authTenantId || 'default')}`);
        if (migFlag) return;
        const snapshot = loadState();
        const [srvBranches, srvProducts, srvSuppliers, srvCustomers] = await Promise.all([
          branchesApi.list().catch(() => []),
          productsApi.list().catch(() => []),
          suppliersApi.list().catch(() => []),
          customersApi.list().catch(() => [])
        ]);
        if (snapshot) {
          if (Array.isArray(srvBranches) && srvBranches.length === 0) {
            const list = snapshot.branches?.branches || [];
            if (Array.isArray(list) && list.length > 0) {
              for (const b of list) {
                try { await branchesApi.create({ id: b.id, name: b.name, code: b.code }); } catch {}
              }
            } else {
              try { await branchesApi.create({ id: 'main', name: 'Main Branch', code: 'MAIN' }); } catch {}
            }
          }
          if (Array.isArray(srvProducts) && srvProducts.length === 0) {
            const list = snapshot.products?.products || [];
            for (const p of list) {
              const { id, name, sku, price, category, barcode, lowStock, unitKind, unitValue, unitSymbol, sizeLabel, shoeSize, attributes, packs, variants, stockByBranch, image } = p;
              try { await productsApi.create({ id, name, sku, price, category, barcode, lowStock, unitKind, unitValue, unitSymbol, sizeLabel, shoeSize, attributes, packs, variants, stockByBranch, image }); } catch {}
            }
          }
          if (Array.isArray(srvSuppliers) && srvSuppliers.length === 0) {
            const list = snapshot.suppliers?.suppliers || [];
            for (const s of list) {
              const { id, name, contact, phone, email } = s;
              try { await suppliersApi.create({ id, name, contact, phone, email }); } catch {}
            }
          }
          if (Array.isArray(srvCustomers) && srvCustomers.length === 0) {
            const list = snapshot.customers?.customers || [];
            for (const c of list) {
              const { id, name, phone, email } = c;
              try { await customersApi.create({ id, name, phone, email }); } catch {}
            }
          }
        }
        clearTenantState(authTenantId || 'default');
        localStorage.setItem(`ptSales:migratedDbV1:${String(authTenantId || 'default')}`, '1');
      } catch {}
    })();
  }, [isAuthed, authTenantId, settingsReady]);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isAuthed || !settingsReady) return;
      try {
        const hasGrant = (grant) => {
          const g = Array.isArray(authGrants) ? authGrants : [];
          if (g.includes(grant)) return true;
          if (grant.startsWith('view_')) return g.includes(`see_${grant.slice(5)}`);
          if (grant.startsWith('see_')) return g.includes(`view_${grant.slice(4)}`);
          return false;
        };
        const roleLower = String(authRole || '').toLowerCase();
        const can = (feature) => isFeatureEnabled(settings, feature);
        const section = (key) => isFeatureEnabled(settings, key);
        const allow = (feature, roles = [], grant) => {
          if (!feature || !can(feature)) return false;
          if (roleLower === 'superadmin') return true;
          const roleOk = (roles || []).map(x => String(x).toLowerCase()).includes(roleLower);
          if (!grant) return roleOk;
          const requested = Array.isArray(grant) ? grant : [grant];
          if (roleLower !== 'admin') return requested.some(hasGrant);
          return roleOk || requested.some(hasGrant);
        };
        const [p, s, c, b, r, sl] = await Promise.allSettled([
          allow('modules.products', ['Admin','Manager','Inventory Staff'], ['view_products','see_products','view_distribution_products','view_warehouse_products']) ? productsApi.list() : Promise.resolve([]),
          section('sections.partners') && allow('modules.suppliers', ['Admin','Manager','Inventory Staff'], ['view_suppliers','see_suppliers']) ? suppliersApi.list() : Promise.resolve([]),
          section('sections.partners') && allow('modules.customers', ['Admin','Manager','Cashier'], ['view_customers','see_customers']) ? customersApi.list() : Promise.resolve([]),
          section('sections.admin') && allow('admin.config', ['Admin'], ['view_config','see_config']) ? branchesApi.list() : Promise.resolve([]),
          section('sections.retail') && allow('pages.retail.refunds', ['Admin','Manager','Cashier'], ['view_refunds','see_refunds']) ? refundsApi.listRequests() : Promise.resolve([]),
          allow('modules.sales', ['Admin','Manager','Cashier'], ['view_sales','see_sales']) ? salesApi.list() : Promise.resolve([])
        ]);
        if (alive && p.status === 'fulfilled' && Array.isArray(p.value)) dispatch(setProducts(p.value));
        if (alive && s.status === 'fulfilled' && Array.isArray(s.value)) dispatch(setSuppliers(s.value));
        if (alive && c.status === 'fulfilled' && Array.isArray(c.value)) dispatch(setCustomers(c.value));
        if (alive && b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length > 0) dispatch(setBranches(b.value));
        if (alive && r.status === 'fulfilled' && Array.isArray(r.value)) dispatch(setRequests(r.value));
        if (alive && sl.status === 'fulfilled' && Array.isArray(sl.value)) dispatch(setSales(sl.value));
      } catch {}
    })();
    return () => { alive = false; };
  }, [dispatch, isAuthed, settings, settingsReady, authRole, authGrants]);
  useEffect(() => {
    let alive = true;
    const int = setInterval(async () => {
      if (!alive) return;
      if (!navigator.onLine) return;
      try {
        await ensureOnlineJwt();
      } catch {}
    }, 60000);
    return () => {
      alive = false;
      clearInterval(int);
    };
  }, []);
  useEffect(() => {
    if (!isAuthed) return;
    const userGrants = settings?.userGrants;
    const g = (userGrants && userName) ? (userGrants[userName] || []) : [];
    dispatch(setGrants(filterGrantsByTenantFlags(Array.isArray(g) ? g : [], settings)));
  }, [isAuthed, settings, settings?.userGrants, userName, dispatch]);
  useEffect(() => {
    let alive = true;
    const idleMs = 180000;
    let lastActive = Date.now();
    function bump() { lastActive = Date.now(); }
    function onVis() { if (!document.hidden) lastActive = Date.now(); }
    if (isAuthedNow) {
      window.addEventListener('mousemove', bump, { passive: true });
      window.addEventListener('mousedown', bump, { passive: true });
      window.addEventListener('keydown', bump, { passive: true });
      window.addEventListener('touchstart', bump, { passive: true });
      window.addEventListener('scroll', bump, { passive: true });
      document.addEventListener('visibilitychange', onVis, { passive: true });
    }
    const interval = setInterval(async () => {
      if (!navigator.onLine || !alive || !isAuthed || !settingsReady) return;
      if (Date.now() - lastActive >= idleMs) {
        const tenantId = String(authTenantId || localStorage.getItem('ptSales:tenantId') || 'default');
        try { await authApi.logout(); } catch {}
        try { localStorage.removeItem('ptSales:authToken'); } catch {}
        dispatch(resetTenantAppState(tenantId));
        dispatch(logout());
        return;
      }
      try {
        const hasGrant = (grant) => {
          const g = Array.isArray(authGrants) ? authGrants : [];
          if (g.includes(grant)) return true;
          if (grant.startsWith('view_')) return g.includes(`see_${grant.slice(5)}`);
          if (grant.startsWith('see_')) return g.includes(`view_${grant.slice(4)}`);
          return false;
        };
        const roleLower = String(authRole || '').toLowerCase();
        const can = (feature) => isFeatureEnabled(settings, feature);
        const section = (key) => isFeatureEnabled(settings, key);
        const allow = (feature, roles = [], grant) => {
          if (!feature || !can(feature)) return false;
          if (roleLower === 'superadmin') return true;
          const roleOk = (roles || []).map(x => String(x).toLowerCase()).includes(roleLower);
          if (!grant) return roleOk;
          const requested = Array.isArray(grant) ? grant : [grant];
          if (roleLower !== 'admin') return requested.some(hasGrant);
          return roleOk || requested.some(hasGrant);
        };
        const [p, s, c, b, r, sl, u, au, invs, pr, tr, exr, adr] = await Promise.allSettled([
          allow('modules.products', ['Admin','Manager','Inventory Staff'], ['view_products','see_products','view_distribution_products','view_warehouse_products']) ? productsApi.list() : Promise.resolve([]),
          section('sections.partners') && allow('modules.suppliers', ['Admin','Manager','Inventory Staff'], ['view_suppliers','see_suppliers']) ? suppliersApi.list() : Promise.resolve([]),
          section('sections.partners') && allow('modules.customers', ['Admin','Manager','Cashier'], ['view_customers','see_customers']) ? customersApi.list() : Promise.resolve([]),
          section('sections.admin') && allow('admin.config', ['Admin'], ['view_config','see_config']) ? branchesApi.list() : Promise.resolve([]),
          section('sections.retail') && allow('modules.refunds', ['Admin','Manager','Cashier'], ['view_refunds','see_refunds']) ? refundsApi.listRequests() : Promise.resolve([]),
          allow('modules.sales', ['Admin','Manager','Cashier'], ['view_sales','see_sales']) ? salesApi.list() : Promise.resolve([]),
          section('sections.admin') && allow('admin.users', ['Admin'], ['view_users','see_users']) ? usersApi.list() : Promise.resolve([]),
          allow('admin.audit', ['Admin'], ['view_audit','see_audit']) ? auditsApi.list() : Promise.resolve([]),
          allow('modules.invoices', ['Admin','Manager','Cashier'], ['view_invoices','see_invoices','view_wholesale_invoices','view_warehouse_invoices']) ? invoicesApi.list() : Promise.resolve([]),
          section('sections.retail') && allow('pages.retail.purchases', ['Admin','Manager','Inventory Staff','Director'], ['approve_purchases','view_purchases','see_purchases']) ? purchasesApi.listRequests({ status: 'pending_director', limit: 200 }) : Promise.resolve([]),
          section('sections.retail') && allow('pages.retail.transfers', ['Admin','Manager','Inventory Staff','Director'], ['approve_transfers','view_transfers','see_transfers']) ? transfersApi.listRequests({ status: 'pending_director', limit: 200 }) : Promise.resolve([]),
          section('sections.expense') && (allow('modules.expenses', ['Admin','Manager'], ['view_expenses','see_expenses','add_expenses']) || allow('modules.expenseApprovals', ['Admin','Manager'], ['approve_expenses'])) ? expensesApi.listRequests({ status: 'pending', limit: 200 }) : Promise.resolve([]),
          section('sections.retail') && allow('pages.retail.adjustments', ['Admin','Manager','Inventory Staff','Director'], ['approve_adjustments','view_adjustments','see_adjustments']) ? adjustmentsApi.listRequests({ status: 'pending_director', limit: 200 }) : Promise.resolve([])
        ]);
        if (alive && p.status === 'fulfilled' && Array.isArray(p.value)) dispatch(setProducts(p.value));
        if (alive && s.status === 'fulfilled' && Array.isArray(s.value)) dispatch(setSuppliers(s.value));
        if (alive && c.status === 'fulfilled' && Array.isArray(c.value)) dispatch(setCustomers(c.value));
        if (alive && b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length > 0) dispatch(setBranches(b.value));
        if (alive && r.status === 'fulfilled' && Array.isArray(r.value)) dispatch(setRequests(r.value));
        if (alive && sl.status === 'fulfilled' && Array.isArray(sl.value)) dispatch(setSales(sl.value));
        if (alive && u.status === 'fulfilled' && Array.isArray(u.value)) dispatch(setUsers(u.value));
        if (alive && au.status === 'fulfilled' && Array.isArray(au.value) && au.value.length > 0) dispatch(setAuditEntries(au.value));
        if (alive && invs.status === 'fulfilled' && Array.isArray(invs.value)) dispatch(setInvoices(invs.value));
        if (alive && pr.status === 'fulfilled' && Array.isArray(pr.value)) {
          const { setPurchaseRequests } = await import('./store/purchasesSlice');
          dispatch(setPurchaseRequests(pr.value));
        }
        if (alive && tr.status === 'fulfilled' && Array.isArray(tr.value)) {
          const { setTransferRequests } = await import('./store/transfersSlice');
          dispatch(setTransferRequests(tr.value));
        }
        if (alive && exr.status === 'fulfilled' && Array.isArray(exr.value)) {
          const { setExpenseRequests } = await import('./store/expenseRequestsSlice');
          dispatch(setExpenseRequests(exr.value));
        }
        if (alive && adr.status === 'fulfilled' && Array.isArray(adr.value)) {
          const { setAdjustmentRequests } = await import('./store/adjustmentRequestsSlice');
          dispatch(setAdjustmentRequests(adr.value));
        }
      } catch {}
    }, Math.max(10000, Number(refreshSec) * 1000));
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('mousedown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('touchstart', bump);
      window.removeEventListener('scroll', bump);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [dispatch, refreshSec, isAuthed, isAuthedNow, settings, settingsReady, authTenantId, authRole, authGrants]);
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/r/:id" element={<ReceiptPublicPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Navigate to="/pos" replace />} />
            <Route path="/dashboard" element={<ProtectedRoute feature="modules.dashboard" roles={['Admin','Manager']} grant={['view_dashboard','see_dashboard']}><DashboardPage /></ProtectedRoute>} />
            <Route path="/pos" element={<ProtectedRoute feature="pages.retail.pos" roles={['Admin','Manager','Cashier']} grant={['view_pos','see_pos']}><PosPage mode="retail" /></ProtectedRoute>} />
            <Route path="/wholesale-pos" element={<ProtectedRoute feature="pages.distribution.pos" roles={['Admin','Manager','Cashier']} grant={['view_wholesale_pos']}><PosPage mode="wholesale" /></ProtectedRoute>} />
            <Route path="/wholesale-goods" element={<ProtectedRoute feature="pages.distribution.goods" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['view_distribution_products']}><WholesaleGoodsPage /></ProtectedRoute>} />
            <Route path="/wholesale-invoices" element={<ProtectedRoute feature="pages.distribution.invoices" roles={['Admin','Manager','Cashier']} grant={['view_wholesale_invoices']}><WholesaleInvoicesPage /></ProtectedRoute>} />
            <Route path="/wholesale-purchase" element={<ProtectedRoute feature="pages.distribution.purchase" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['add_purchases','view_purchases','see_purchases']}><WholesalePurchasePage /></ProtectedRoute>} />
            <Route path="/wholesale-transfer" element={<ProtectedRoute feature="pages.distribution.transfer" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['add_transfers','view_transfers','see_transfers']}><WholesaleTransferPage /></ProtectedRoute>} />
            <Route path="/wholesale-adjustment" element={<ProtectedRoute feature="pages.distribution.adjustment" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['add_adjustments','view_adjustments','see_adjustments']}><WholesaleAdjustmentPage /></ProtectedRoute>} />
            <Route path="/wholesale-refund" element={<ProtectedRoute feature="pages.distribution.refund" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['view_distribution_refunds','add_distribution_refunds']}><WholesaleRefundPage /></ProtectedRoute>} />
            <Route path="/warehouse-purchase" element={<ProtectedRoute feature="pages.warehouse.purchase" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['add_purchases','view_purchases','see_purchases']}><WarehousePurchasePage /></ProtectedRoute>} />
            <Route path="/warehouse-transfer" element={<ProtectedRoute feature="pages.warehouse.transfer" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['add_transfers','view_transfers','see_transfers']}><WarehouseTransferPage /></ProtectedRoute>} />
            <Route path="/warehouse-adjustment" element={<ProtectedRoute feature="pages.warehouse.adjustment" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['add_adjustments','view_adjustments','see_adjustments']}><WarehouseAdjustmentPage /></ProtectedRoute>} />
            <Route path="/warehouse-goods" element={<ProtectedRoute feature="pages.warehouse.goods" roles={['Admin','Manager','Inventory Staff','Cashier']} grant={['view_warehouse_products']}><WarehouseGoodsPage /></ProtectedRoute>} />
            <Route path="/warehouse-invoices" element={<ProtectedRoute feature="pages.warehouse.invoices" roles={['Admin','Manager','Cashier']} grant={['view_warehouse_invoices']}><WarehouseInvoicesPage /></ProtectedRoute>} />
            <Route path="/warehouse-approvals" element={<ProtectedRoute feature="pages.warehouse.approvals" roles={['Admin','Manager','SuperAdmin']} grant={['view_warehouse_approvals','approve_wholesale_director','approve_wholesale_manager']}><WarehouseApprovalsPage /></ProtectedRoute>} />
            <Route path="/sales" element={<ProtectedRoute feature="modules.sales" roles={['Admin','Manager','Cashier']} grant={['view_sales','see_sales']}><SalesPage /></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute feature="modules.invoices" roles={['Admin','Manager','Cashier']} grant={['view_invoices','see_invoices']}><InvoicesPage /></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute feature="modules.products" roles={['Admin','Manager','Inventory Staff']} grant={['view_products','see_products']}><ProductsPage /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute feature="modules.inventory" roles={['Admin','Manager','Inventory Staff']} grant={['view_inventory','see_inventory']}><InventoryPage /></ProtectedRoute>} />
            <Route path="/serialized-inventory" element={<ProtectedRoute feature="modules.inventory" roles={['Admin','Manager','Inventory Staff']} grant={['view_inventory','see_inventory','view_serialized_inventory']}><SerializedInventoryPage /></ProtectedRoute>} />
            <Route path="/purchases" element={<ProtectedRoute feature="pages.retail.purchases" roles={['Admin','Manager','Inventory Staff']} grant={['view_purchases','see_purchases']}><PurchasesPage /></ProtectedRoute>} />
            <Route path="/expenses" element={<ProtectedRoute feature="sections.expense" roles={['Admin','Manager']} grant={['view_expenses','see_expenses','add_expenses']}><ExpensesPage /></ProtectedRoute>} />
          <Route path="/expense-approvals" element={<ProtectedRoute feature="sections.expense" roles={['Admin','Manager','SuperAdmin']} grant={['approve_expenses']}><ExpenseApprovalsPage /></ProtectedRoute>} />
            <Route path="/transfers" element={<ProtectedRoute feature="pages.retail.transfers" roles={['Admin','Manager','Inventory Staff']} grant={['view_transfers','see_transfers']}><TransfersPage /></ProtectedRoute>} />
            <Route path="/adjustments" element={<ProtectedRoute feature="pages.retail.adjustments" roles={['Admin','Manager','Inventory Staff']} grant={['view_adjustments','see_adjustments']}><AdjustmentsPage /></ProtectedRoute>} />
            <Route path="/suppliers" element={<ProtectedRoute feature="sections.partners" roles={['Admin','Manager','Inventory Staff']} grant={['view_suppliers','see_suppliers']}><SuppliersPage /></ProtectedRoute>} />
            <Route path="/labels" element={<ProtectedRoute feature="modules.labels" roles={['Admin','Manager','Inventory Staff']} grant={['view_labels','see_labels']}><LabelsPage /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute feature="modules.reports" roles={['Admin','Manager','Auditor']} grant={['view_reports','see_reports']}><ReportsPage /></ProtectedRoute>} />
            <Route path="/backup" element={<ProtectedRoute feature="modules.backup" roles={['Admin','Manager','SuperAdmin']} grant={['export_tenant_data','import_tenant_data']}><BackupPage /></ProtectedRoute>} />
            <Route path="/imei-conflicts" element={<ProtectedRoute feature="modules.backup" roles={['Admin','Manager','SuperAdmin']} grant={['view_imei_conflicts']}><ImeiConflictsPage /></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute feature="sections.partners" roles={['Admin','Manager','Cashier']} grant={['view_customers','see_customers']}><CustomersPage /></ProtectedRoute>} />
            <Route path="/credit-control" element={<ProtectedRoute feature="modules.creditControl" roles={['Admin','Manager','Cashier']} grant={['view_credit_control']}><CreditControlPage /></ProtectedRoute>} />
            <Route path="/easybuy/good-clients" element={<ProtectedRoute feature="modules.creditControl" roles={['Admin','Manager','Cashier']} grant={['view_credit_control']}><EasyBuyGoodClientsPage /></ProtectedRoute>} />
            <Route path="/easybuy/defaulters" element={<ProtectedRoute feature="modules.creditControl" roles={['Admin','Manager','Cashier']} grant={['view_credit_control']}><EasyBuyDefaultersPage /></ProtectedRoute>} />
            <Route path="/easybuy/repayment-approvals" element={<ProtectedRoute feature="modules.creditControl" roles={['Admin','Manager','SuperAdmin']} grant={['approve_credit_director','approve_credit_manager','view_credit_control','view_credit_repayment_approvals']}><EasyBuyRepaymentApprovalsPage /></ProtectedRoute>} />
            <Route path="/approvals-center" element={<ProtectedRoute feature="modules.approvalsCenter" roles={['Admin','Manager','SuperAdmin']} grant={['view_approvals','approve_wholesale_director','approve_wholesale_manager','approve_credit_director','approve_credit_manager']}><ApprovalsPage /></ProtectedRoute>} />
            <Route path="/refunds" element={<ProtectedRoute feature="pages.retail.refunds" roles={['Admin','Manager','Cashier']} grant={['view_refunds','see_refunds']}><RefundsPage /></ProtectedRoute>} />
            <Route path="/refund-approvals" element={<ProtectedRoute feature="modules.refundApprovals" roles={['Admin','Manager','SuperAdmin']} grant="approve_refunds"><RefundApprovalsPage /></ProtectedRoute>} />
            <Route path="/stock-records" element={<ProtectedRoute feature="sections.admin" roles={['Admin','SuperAdmin']} grant={['view_stock_records','see_stock_records']}><StockRecordsPage /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute feature="sections.admin" roles={['Admin','SuperAdmin']} grant={['view_users','see_users']}><UsersPage /></ProtectedRoute>} />
            <Route path="/tenants" element={<ProtectedRoute roles={['SuperAdmin']}><TenantsPage /></ProtectedRoute>} />
            <Route path="/cashdrawer" element={<ProtectedRoute feature="sections.admin" roles={['Admin','Manager','Cashier']} grant={['view_cashdrawer','see_cashdrawer']}><CashDrawerPage /></ProtectedRoute>} />
            <Route path="/config" element={<ProtectedRoute feature="sections.admin" roles={['Admin','Manager']} grant={['view_config','see_config']}><ConfigSettingsPage /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute feature="admin.audit" roles={['Admin','SuperAdmin']} grant={['view_audit','see_audit']}><AuditLogPage /></ProtectedRoute>} />
            <Route path="/manual" element={<ProtectedRoute feature="sections.admin" roles={['Admin','SuperAdmin']}><AdminManualPage /></ProtectedRoute>} />
            <Route path="/docs" element={<ProtectedRoute feature="sections.admin" roles={['SuperAdmin']}><DocsPage /></ProtectedRoute>} />
            <Route path="/server-logs" element={<ProtectedRoute feature="sections.admin" roles={['SuperAdmin']}><ServerLogsPage /></ProtectedRoute>} />
            <Route path="/godhand" element={<ProtectedRoute feature="sections.admin" roles={['SuperAdmin']}><GodHandPage /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
