import { NavLink, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useCallback, useEffect, useState } from 'react';
import { isFeatureEnabled } from '../utils/featureFlags';
import { listCreditSales } from '../api/credits';
import { listApprovals } from '../api/approvals';
import { listOperations } from '../api/wholesale';
import { useChatNotifications } from './ChatNotificationsProvider';
import { useAppLanguage } from '../utils/localization';

function Sidebar({ collapsed, onNavigate }) {
  const location = useLocation();
  const appName = useSelector(s => s.settings.appName);
  const settings = useSelector(s => s.settings);
  const products = useSelector(s => s.products.products || []);
  const role = useSelector(s => s.auth.role);
  const grants = useSelector(s => s.auth.grants);
  const offlineTotal = useSelector(s => s.offlineQueue.total);
  const rl = String(role || '').toLowerCase();
  const expensePending = useSelector(s => (s.expenseRequests?.requests || []).filter(r => String(r.status || '') === 'pending_approval').length);
  const refundPending = useSelector(s => (s.refunds?.requests || []).filter(r => String(r.status || '') === 'pending_approval').length);
  const pendingStages = ['pending_approval', 'pending_director', 'pending_manager'];
  const { unreadCount: communicationUnreadCount } = useChatNotifications();
  const { t } = useAppLanguage();
  const adjustmentPending = useSelector(s => (s.adjustmentRequests?.requests || []).filter(r => pendingStages.includes(String(r.status || ''))).length);
  const purchasePending = useSelector(s => (s.purchases?.requests || []).filter(r => pendingStages.includes(String(r.status || ''))).length);
  const transferPending = useSelector(s => (s.transfers?.requests || []).filter(r => pendingStages.includes(String(r.status || ''))).length);
  const [retailOpen, setRetailOpen] = useState(false);
  const [wholesaleOpen, setWholesaleOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [easyBuyOpen, setEasyBuyOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [communicationOpen, setCommunicationOpen] = useState(false);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [easyBuyOverdue, setEasyBuyOverdue] = useState(0);
  const [easyBuyPendingApprovals, setEasyBuyPendingApprovals] = useState(0);
  const [warehousePendingApprovals, setWarehousePendingApprovals] = useState(0);
  const wholesaleLowStock = products.filter(product => {
    const stock = Object.values(product?.wholesaleStockByBranch || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    const threshold = Number(product?.wholesaleLowStock != null ? product.wholesaleLowStock : (product?.lowStock || 0));
    return stock <= threshold;
  }).length;
  const warehouseLowStock = products.filter(product => {
    const stock = Object.values(product?.warehouseStockByBranch || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    const threshold = Number(product?.warehouseLowStock != null ? product.warehouseLowStock : (product?.lowStock || 0));
    return stock <= threshold;
  }).length;
  const can = useCallback((list, grant) => {
    if (!Array.isArray(list) || list.length === 0) return true;
    if (rl === 'superadmin') return true;
    const grantFeatureEnabled = (g) => settings?.featureFlags?.[`grants.${String(g || '')}`] !== false;
    if (grant) {
      const requested = Array.isArray(grant) ? grant : [grant];
      if (!requested.some(grantFeatureEnabled)) return false;
    }
    const okRole = list.map(x => String(x).toLowerCase()).includes(rl);
    function has(g) {
      if (!g) return false;
      const gList = Array.isArray(grants) ? grants : [];
      if (gList.includes(g)) return true;
      if (g.startsWith('view_')) return gList.includes(`see_${g.slice(5)}`);
      if (g.startsWith('see_')) return gList.includes(`view_${g.slice(4)}`);
      return false;
    }
    const okGrant = Array.isArray(grant) ? grant.some(has) : has(grant);
    if (grant && rl !== 'admin') return okGrant;
    return okRole || okGrant;
  }, [grants, rl, settings]);
  const sectionEnabled = useCallback((key) => isFeatureEnabled(settings, key), [settings]);
  function toggleGroup(group) {
    setRetailOpen(group === 'retail' ? !retailOpen : false);
    setWholesaleOpen(group === 'wholesale' ? !wholesaleOpen : false);
    setWarehouseOpen(group === 'warehouse' ? !warehouseOpen : false);
    setEasyBuyOpen(group === 'credit' ? !easyBuyOpen : false);
    setExpenseOpen(group === 'expense' ? !expenseOpen : false);
    setFinanceOpen(group === 'finance' ? !financeOpen : false);
    setCommunicationOpen(group === 'communication' ? !communicationOpen : false);
    setPartnersOpen(group === 'partners' ? !partnersOpen : false);
  }
  function handleNavClick(event) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || typeof onNavigate !== 'function') return;
    onNavigate();
  }
  useEffect(() => {
    const path = String(location.pathname || '');
    const isRetail = ['/pos','/purchases','/transfers','/adjustments','/refunds','/invoices'].some(prefix => path.startsWith(prefix));
    const isDistribution = ['/wholesale-goods','/wholesale-pos','/wholesale-invoices','/wholesale-purchase','/wholesale-transfer','/wholesale-adjustment','/wholesale-refund'].some(prefix => path.startsWith(prefix));
    const isWarehouse = ['/warehouse-goods','/warehouse-invoices','/warehouse-purchase','/warehouse-transfer','/warehouse-adjustment','/warehouse-approvals'].some(prefix => path.startsWith(prefix));
    const isCredit = ['/credit-control','/easybuy/'].some(prefix => path.startsWith(prefix));
    const isExpense = ['/expenses','/expense-approvals'].some(prefix => path.startsWith(prefix));
    const isFinance = ['/cash-reconciliation'].some(prefix => path.startsWith(prefix));
    const isCommunication = ['/communication/chat', '/communication/ask-pt-ai'].some(prefix => path.startsWith(prefix));
    const isPartners = ['/suppliers','/customers'].some(prefix => path.startsWith(prefix));
    setRetailOpen(isRetail);
    setWholesaleOpen(isDistribution);
    setWarehouseOpen(isWarehouse);
    setEasyBuyOpen(isCredit);
    setExpenseOpen(isExpense);
    setFinanceOpen(isFinance);
    setCommunicationOpen(isCommunication);
    setPartnersOpen(isPartners);
  }, [location.pathname]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const canCredit = isFeatureEnabled(settings, 'modules.creditControl') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_credit_control']);
        const canApprovals = isFeatureEnabled(settings, 'modules.approvalsCenter') && can(['Admin','Manager','SuperAdmin'],['view_approvals','approve_credit_director','approve_credit_manager','approve_retail_director','approve_retail_manager','approve_distribution_director','approve_distribution_manager','approve_warehouse_director','approve_warehouse_manager']);
        const canWarehouse = sectionEnabled('sections.warehouse') && (
          (isFeatureEnabled(settings, 'pages.warehouse.goods') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['view_warehouse_products']))
          || (isFeatureEnabled(settings, 'pages.warehouse.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_warehouse_invoices']))
          || (isFeatureEnabled(settings, 'pages.warehouse.purchase') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_purchases']))
          || (isFeatureEnabled(settings, 'pages.warehouse.transfer') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_transfers']))
          || (isFeatureEnabled(settings, 'pages.warehouse.adjustment') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_adjustments']))
          || (isFeatureEnabled(settings, 'pages.warehouse.approvals') && can(['Admin','Manager','SuperAdmin'], ['view_warehouse_approvals','approve_warehouse_director','approve_warehouse_manager']))
        );
        const [overdueRows, directorRows, managerRows, warehouseRows] = await Promise.all([
          canCredit ? listCreditSales({ status: 'overdue' }).catch(() => []) : Promise.resolve([]),
          canApprovals ? listApprovals({ actionType: 'credit_repayment', status: 'pending_director' }).catch(() => []) : Promise.resolve([]),
          canApprovals ? listApprovals({ actionType: 'credit_repayment', status: 'pending_manager' }).catch(() => []) : Promise.resolve([]),
          (canApprovals && canWarehouse)
            ? Promise.all([
                listOperations({ operationArea: 'warehouse', status: 'pending_director' }).catch(() => []),
                listOperations({ operationArea: 'warehouse', status: 'pending_manager' }).catch(() => [])
              ]).catch(() => [[], []])
            : Promise.resolve([[], []])
        ]);
        if (!alive) return;
        setEasyBuyOverdue(Array.isArray(overdueRows) ? overdueRows.length : 0);
        setEasyBuyPendingApprovals((Array.isArray(directorRows) ? directorRows.length : 0) + (Array.isArray(managerRows) ? managerRows.length : 0));
        const totalWarehousePending = Array.isArray(warehouseRows)
          ? warehouseRows.reduce((sum, group) => sum + (Array.isArray(group) ? group.filter(row => ['purchase','transfer','adjustment'].includes(String(row?.operationType || '').toLowerCase())).length : 0), 0)
          : 0;
        setWarehousePendingApprovals(totalWarehousePending);
      } catch {}
    })();
    return () => { alive = false; };
  }, [settings, role, grants, can, sectionEnabled]);
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <img src="/logo512.png" alt="logo" />
        <div className="sidebar-title">{appName}</div>
      </div>
      <nav className="sidebar-nav" onClick={handleNavClick}>
        {isFeatureEnabled(settings, 'modules.dashboard') && can(['Admin','Manager','SuperAdmin'],['view_dashboard','see_dashboard']) && (
        <NavLink to="/dashboard" className="sidebar-link" title={t('Dashboard')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill="currentColor"/></svg>
          <span className="sidebar-text">{t('Dashboard')}</span>
        </NavLink>
        )}
        
        {(sectionEnabled('sections.retail') && (
          (isFeatureEnabled(settings, 'pages.retail.pos') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_pos','see_pos'])) ||
          (isFeatureEnabled(settings, 'pages.retail.purchases') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_purchases','see_purchases'])) ||
          (isFeatureEnabled(settings, 'pages.retail.transfers') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_transfers','see_transfers'])) ||
          (isFeatureEnabled(settings, 'pages.retail.adjustments') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_adjustments','see_adjustments'])) ||
          (isFeatureEnabled(settings, 'pages.retail.refunds') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_refunds','see_refunds'])) ||
          (isFeatureEnabled(settings, 'modules.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_invoices','see_invoices']))
        )) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('retail')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M7 4h10a2 2 0 012 2v4H5V6a2 2 0 012-2zm-2 8h14l-1 7a2 2 0 01-2 1H8a2 2 0 01-2-1l-1-7z" stroke="currentColor" strokeWidth="2"/></svg>
              <span className="sidebar-text">{t('Retail')}</span>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: retailOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          {retailOpen && (
          <div className="sidebar-subgroup">
            {isFeatureEnabled(settings, 'pages.retail.pos') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_pos','see_pos']) && (
            <NavLink to="/pos" className="sidebar-link" title={t('POS')}>
              <span className="sidebar-text">{t('POS')}</span>
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'pages.retail.purchases') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_purchases','see_purchases']) && (
            <NavLink to="/purchases" className="sidebar-link" title={t('Purchases')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Purchases')}</span>
              {purchasePending > 0 && can(['Admin','Manager','SuperAdmin'],['approve_purchases','approve_retail_director','approve_retail_manager']) && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {purchasePending}
                </span>
              )}
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'pages.retail.transfers') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_transfers','see_transfers']) && (
            <NavLink to="/transfers" className="sidebar-link" title={t('Transfers')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Transfers')}</span>
              {transferPending > 0 && can(['Admin','Manager','SuperAdmin'],['approve_transfers','approve_retail_director','approve_retail_manager']) && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {transferPending}
                </span>
              )}
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'pages.retail.adjustments') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_adjustments','see_adjustments']) && (
            <NavLink to="/adjustments" className="sidebar-link" title={t('Adjustments')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Adjustments')}</span>
              {adjustmentPending > 0 && can(['Admin','Manager','SuperAdmin'],['approve_adjustments','approve_retail_director','approve_retail_manager']) && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {adjustmentPending}
                </span>
              )}
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'modules.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_invoices','see_invoices']) && (
            <NavLink to="/invoices" className="sidebar-link" title={t('Retail Invoices')}>
              <span className="sidebar-text">{t('Retail Invoices')}</span>
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'pages.retail.refunds') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_refunds','see_refunds']) && (
            <NavLink to="/refunds" className="sidebar-link" title={t('Refunds')}>
              <span className="sidebar-text">{t('Refunds')}</span>
            </NavLink>
            )}
          </div>
          )}
        </div>
        )}
        {sectionEnabled('sections.distribution') && (
          (isFeatureEnabled(settings, 'pages.distribution.goods') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['view_distribution_products'])) ||
          (isFeatureEnabled(settings, 'pages.distribution.pos') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_wholesale_pos'])) ||
          (isFeatureEnabled(settings, 'pages.distribution.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_wholesale_invoices'])) ||
          (isFeatureEnabled(settings, 'pages.distribution.purchase') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_wholesale_purchases'])) ||
          (isFeatureEnabled(settings, 'pages.distribution.transfer') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_wholesale_transfers'])) ||
          (isFeatureEnabled(settings, 'pages.distribution.adjustment') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_wholesale_adjustments'])) ||
          (isFeatureEnabled(settings, 'pages.distribution.refund') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['view_distribution_refunds','add_distribution_refunds']))
        ) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('wholesale')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M4 6h16v12H4z" stroke="currentColor" strokeWidth="2"/><path d="M8 10h8M8 14h8M8 18h5" stroke="currentColor" strokeWidth="2"/></svg>
              <span className="sidebar-text">{t('Distribution')}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {wholesaleLowStock > 0 && (
                <span style={{ minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {wholesaleLowStock}
                </span>
              )}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: wholesaleOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </button>
          {wholesaleOpen && (
          <div className="sidebar-subgroup">
            {isFeatureEnabled(settings, 'pages.distribution.goods') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['view_distribution_products']) && (<NavLink to="/wholesale-goods" className="sidebar-link" title={t('Distribution Goods')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Distribution Goods')}</span>
              {wholesaleLowStock > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {wholesaleLowStock}
                </span>
              )}
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.distribution.pos') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_wholesale_pos']) && (<NavLink to="/wholesale-pos" className="sidebar-link" title={t('Distribution POS')}>
              <span className="sidebar-text">{t('Distribution POS')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.distribution.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_wholesale_invoices']) && (<NavLink to="/wholesale-invoices" className="sidebar-link" title={t('Distribution Invoices')}>
              <span className="sidebar-text">{t('Distribution Invoices')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.distribution.purchase') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_wholesale_purchases']) && (<NavLink to="/wholesale-purchase" className="sidebar-link" title={t('Distribution Purchase')}>
              <span className="sidebar-text">{t('Distribution Purchase')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.distribution.transfer') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_wholesale_transfers']) && (<NavLink to="/wholesale-transfer" className="sidebar-link" title={t('Distribution Transfer')}>
              <span className="sidebar-text">{t('Distribution Transfer')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.distribution.adjustment') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_wholesale_adjustments']) && (<NavLink to="/wholesale-adjustment" className="sidebar-link" title={t('Distribution Adjustment')}>
              <span className="sidebar-text">{t('Distribution Adjustment')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.distribution.refund') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['view_distribution_refunds','add_distribution_refunds']) && (<NavLink to="/wholesale-refund" className="sidebar-link" title={t('Distribution Refund')}>
              <span className="sidebar-text">{t('Distribution Refund')}</span>
            </NavLink>)}
          </div>
          )}
        </div>
        )}
        {sectionEnabled('sections.warehouse') && (
          (isFeatureEnabled(settings, 'pages.warehouse.goods') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['view_warehouse_products'])) ||
          (isFeatureEnabled(settings, 'pages.warehouse.pos') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_warehouse_pos'])) ||
          (isFeatureEnabled(settings, 'pages.warehouse.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_warehouse_invoices'])) ||
          (isFeatureEnabled(settings, 'pages.warehouse.purchase') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_purchases'])) ||
          (isFeatureEnabled(settings, 'pages.warehouse.transfer') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_transfers'])) ||
          (isFeatureEnabled(settings, 'pages.warehouse.adjustment') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_adjustments'])) ||
          (isFeatureEnabled(settings, 'pages.warehouse.approvals') && can(['Admin','Manager','SuperAdmin'], ['view_warehouse_approvals','approve_warehouse_director','approve_warehouse_manager']))
        ) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('warehouse')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M3 7h18v13H3V7z" stroke="currentColor" strokeWidth="2"/><path d="M8 7V4h8v3" stroke="currentColor" strokeWidth="2"/></svg>
              <span className="sidebar-text">{t('Warehouse')}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {warehouseLowStock > 0 && (
                <span style={{ minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {warehouseLowStock}
                </span>
              )}
              {warehousePendingApprovals > 0 && (
                <span style={{ minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {warehousePendingApprovals}
                </span>
              )}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: warehouseOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </button>
          {warehouseOpen && (
          <div className="sidebar-subgroup">
            {isFeatureEnabled(settings, 'pages.warehouse.goods') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['view_warehouse_products']) && (<NavLink to="/warehouse-goods" className="sidebar-link" title={t('Warehouse Goods')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Warehouse Goods')}</span>
              {warehouseLowStock > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {warehouseLowStock}
                </span>
              )}
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.warehouse.pos') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_warehouse_pos']) && (<NavLink to="/warehouse-pos" className="sidebar-link" title={t('Warehouse POS')}>
              <span className="sidebar-text">{t('Warehouse POS')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.warehouse.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'], ['view_warehouse_invoices']) && (<NavLink to="/warehouse-invoices" className="sidebar-link" title={t('Warehouse Invoices')}>
              <span className="sidebar-text">{t('Warehouse Invoices')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.warehouse.purchase') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_purchases']) && (<NavLink to="/warehouse-purchase" className="sidebar-link" title={t('Warehouse Purchase')}>
              <span className="sidebar-text">{t('Warehouse Purchase')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.warehouse.transfer') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_transfers']) && (<NavLink to="/warehouse-transfer" className="sidebar-link" title={t('Warehouse Transfer')}>
              <span className="sidebar-text">{t('Warehouse Transfer')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.warehouse.adjustment') && can(['Admin','Manager','Inventory Staff','Cashier','SuperAdmin'], ['add_warehouse_adjustments']) && (<NavLink to="/warehouse-adjustment" className="sidebar-link" title={t('Warehouse Adjustment')}>
              <span className="sidebar-text">{t('Warehouse Adjustment')}</span>
            </NavLink>)}
            {isFeatureEnabled(settings, 'pages.warehouse.approvals') && can(['Admin','Manager','SuperAdmin'], ['view_warehouse_approvals','approve_warehouse_director','approve_warehouse_manager']) && (<NavLink to="/warehouse-approvals" className="sidebar-link" title={t('Warehouse Approvals')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Warehouse Approvals')}</span>
              {warehousePendingApprovals > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {warehousePendingApprovals}
                </span>
              )}
            </NavLink>)}
          </div>
          )}
        </div>
        )}
        {isFeatureEnabled(settings, 'modules.sales') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_sales','see_sales']) && (
        <NavLink to="/sales" className="sidebar-link" title={t('Sales')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 13l4-4 4 4 6-6 4 4" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M5 19h14" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Sales')}</span>
        </NavLink>
        )}
        {isFeatureEnabled(settings, 'modules.invoices') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_invoices','see_invoices']) && (
        <NavLink to="/invoices" className="sidebar-link" title={t('Invoices')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 3h12v18H6z" stroke="currentColor" strokeWidth="2"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Invoices')}</span>
        </NavLink>
        )}
        {isFeatureEnabled(settings, 'modules.products') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_products','see_products']) && (
        <NavLink to="/products" className="sidebar-link" title={t('Products')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 7l8-4 8 4-8 4-8-4z" fill="currentColor"/><path d="M4 17l8 4 8-4" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M4 12l8 4 8-4" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
          <span className="sidebar-text">{t('Products')}</span>
        </NavLink>
        )}
        {isFeatureEnabled(settings, 'modules.inventory') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_inventory','see_inventory']) && (
        <>
          <NavLink to="/inventory" className="sidebar-link" title={t('Inventory')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 7h18v13H3V7z" stroke="currentColor" strokeWidth="2"/><path d="M8 7V4h8v3" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Inventory')}</span>
          </NavLink>
          <NavLink to="/serialized-inventory" className="sidebar-link" title={t('Serialized Inventory')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 6h14v12H5z" stroke="currentColor" strokeWidth="2"/><path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Serialized Inventory')}</span>
          </NavLink>
        </>
        )}
        {isFeatureEnabled(settings, 'modules.labels') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_labels','see_labels']) && (
        <NavLink to="/labels" className="sidebar-link" title={t('Labels')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2"/><path d="M8 7V4h8v3" stroke="currentColor" strokeWidth="2"/><path d="M7 13h10" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Labels')}</span>
        </NavLink>
        )}
        {(sectionEnabled('sections.credit') && (
          (isFeatureEnabled(settings, 'modules.creditControl') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_credit_control']))
        )) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('credit')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M3 7h18v10H3z" stroke="currentColor" strokeWidth="2"/><path d="M7 11h10M7 15h6" stroke="currentColor" strokeWidth="2"/></svg>
              <span className="sidebar-text">{t('Credit Sale')}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {(easyBuyOverdue + easyBuyPendingApprovals) > 0 && (
                <span style={{ minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {easyBuyOverdue + easyBuyPendingApprovals}
                </span>
              )}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: easyBuyOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </button>
          {easyBuyOpen && (
          <div className="sidebar-subgroup">
            <NavLink to="/credit-control" className="sidebar-link" title={t('Credit Sale Overview')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Overview')}</span>
              {easyBuyOverdue > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f59e0b', color: '#111827', fontWeight: 800, fontSize: 12 }}>
                  {easyBuyOverdue}
                </span>
              )}
            </NavLink>
            <NavLink to="/easybuy/good-clients" className="sidebar-link" title={t('Good Clients')}>
              <span className="sidebar-text">{t('Good Clients')}</span>
            </NavLink>
            <NavLink to="/easybuy/defaulters" className="sidebar-link" title={t('Defaulters')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Defaulters')}</span>
              {easyBuyOverdue > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {easyBuyOverdue}
                </span>
              )}
            </NavLink>
            <NavLink to="/easybuy/repayment-approvals" className="sidebar-link" title={t('Payment Approvals')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Payment Approvals')}</span>
              {easyBuyPendingApprovals > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {easyBuyPendingApprovals}
                </span>
              )}
            </NavLink>
          </div>
          )}
        </div>
        )}
        {(sectionEnabled('sections.expense') && (
          (isFeatureEnabled(settings, 'modules.expenses') && can(['Admin','Manager','SuperAdmin'],['view_expenses','see_expenses','add_expenses'])) ||
          (isFeatureEnabled(settings, 'modules.expenseApprovals') && can(['Admin','Manager','SuperAdmin'],['approve_expenses']))
        )) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('expense')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 3h12v18H6z" stroke="currentColor" strokeWidth="2"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="2"/></svg>
              <span className="sidebar-text">{t('Expense')}</span>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: expenseOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          {expenseOpen && (
          <div className="sidebar-subgroup">
            {isFeatureEnabled(settings, 'modules.expenses') && can(['Admin','Manager','SuperAdmin'],['view_expenses','see_expenses','add_expenses']) && (
            <NavLink to="/expenses" className="sidebar-link" title={t('Expenses')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Expenses')}</span>
              {expensePending > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {expensePending}
                </span>
              )}
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'modules.expenseApprovals') && can(['Admin','Manager','SuperAdmin'],['approve_expenses']) && (
            <NavLink to="/expense-approvals" className="sidebar-link" title={t('Expense Approvals')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Expense Approvals')}</span>
              {expensePending > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {expensePending}
                </span>
              )}
            </NavLink>
            )}
          </div>
          )}
        </div>
        )}
        {(sectionEnabled('sections.finance') && (
          isFeatureEnabled(settings, 'pages.finance.reconciliation') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_finance_reconciliation','add_finance_reconciliation','approve_finance_reconciliation_director','approve_finance_reconciliation_manager'])
        )) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('finance')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M4 19h16M6 16V9m4 7V5m4 11v-8m4 8v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              <span className="sidebar-text">{t('Finance')}</span>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: financeOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          {financeOpen && (
          <div className="sidebar-subgroup">
            {isFeatureEnabled(settings, 'pages.finance.reconciliation') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_finance_reconciliation','add_finance_reconciliation','approve_finance_reconciliation_director','approve_finance_reconciliation_manager']) && (
            <NavLink to="/cash-reconciliation" className="sidebar-link" title={t('Cash Reconciliation')}>
              <span className="sidebar-text">{t('Cash Reconciliation')}</span>
            </NavLink>
            )}
          </div>
          )}
        </div>
        )}
        {(sectionEnabled('sections.communication') && (
          isFeatureEnabled(settings, 'modules.communication') && can(['Admin','Manager','Cashier','Inventory Staff','SuperAdmin'], ['view_chat', 'send_chat_messages', 'view_pt_ai'])
        )) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('communication')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M4 6h16v10H7l-3 3V6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              <span className="sidebar-text">{t('Communication')}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {communicationUnreadCount > 0 && (
                <span style={{ minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {communicationUnreadCount > 99 ? '99+' : communicationUnreadCount}
                </span>
              )}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: communicationOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </button>
          {communicationOpen && (
          <div className="sidebar-subgroup">
            {isFeatureEnabled(settings, 'pages.communication.chat') && can(['Admin','Manager','Cashier','Inventory Staff','SuperAdmin'], ['view_chat', 'send_chat_messages']) && (
            <NavLink to="/communication/chat" className="sidebar-link" title={t('Chat')} style={{ display: 'flex', alignItems: 'center' }}>
              <span className="sidebar-text">{t('Chat')}</span>
              {communicationUnreadCount > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {communicationUnreadCount > 99 ? '99+' : communicationUnreadCount}
                </span>
              )}
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'pages.communication.askPtAi') && can(['Admin','Manager','Cashier','Inventory Staff','SuperAdmin'], ['view_pt_ai']) && (
            <NavLink to="/communication/ask-pt-ai" className="sidebar-link" title={t('Ask PT AI')}>
              <span className="sidebar-text">{t('Ask PT AI')}</span>
            </NavLink>
            )}
          </div>
          )}
        </div>
        )}
        {(sectionEnabled('sections.partners') && (
          (isFeatureEnabled(settings, 'modules.suppliers') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_suppliers','see_suppliers'])) ||
          (isFeatureEnabled(settings, 'modules.customers') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_customers','see_customers']))
        )) && (
        <div>
          <button className="sidebar-group-toggle" onClick={() => toggleGroup('partners')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M16 11a4 4 0 10-8 0 4 4 0 008 0z" stroke="currentColor" strokeWidth="2"/><path d="M6 21a6 6 0 0112 0" stroke="currentColor" strokeWidth="2"/></svg>
              <span className="sidebar-text">{t('Partners')}</span>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: partnersOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          {partnersOpen && (
          <div className="sidebar-subgroup">
            {isFeatureEnabled(settings, 'modules.suppliers') && can(['Admin','Manager','Inventory Staff','SuperAdmin'],['view_suppliers','see_suppliers']) && (
            <NavLink to="/suppliers" className="sidebar-link" title={t('Suppliers')}>
              <span className="sidebar-text">{t('Suppliers')}</span>
            </NavLink>
            )}
            {isFeatureEnabled(settings, 'modules.customers') && can(['Admin','Manager','Cashier','SuperAdmin'],['view_customers','see_customers']) && (
            <NavLink to="/customers" className="sidebar-link" title={t('Customers')}>
              <span className="sidebar-text">{t('Customers')}</span>
            </NavLink>
            )}
          </div>
          )}
        </div>
        )}
        {isFeatureEnabled(settings, 'modules.approvalsCenter') && can(['Admin','Manager','SuperAdmin'],['view_approvals','approve_retail_director','approve_retail_manager','approve_distribution_director','approve_distribution_manager','approve_warehouse_director','approve_warehouse_manager','approve_credit_director','approve_credit_manager']) && (
        <NavLink to="/approvals-center" className="sidebar-link" title={t('Approvals Center')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h14v18H5z" stroke="currentColor" strokeWidth="2"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Approvals Center')}</span>
        </NavLink>
        )}
        {isFeatureEnabled(settings, 'modules.approvalsCenter') && can(['Admin','Manager','Cashier','SuperAdmin'],['approve_discount_sales']) && (
        <NavLink to="/discount-approvals" className="sidebar-link" title={t('Discount Approval')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16v12H4z" stroke="currentColor" strokeWidth="2"/><path d="M8 11h8M8 15h5" stroke="currentColor" strokeWidth="2"/><path d="M15 5l4 4" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Discount Approval')}</span>
        </NavLink>
        )}
        {isFeatureEnabled(settings, 'modules.refundApprovals') && can(['Admin','Manager','SuperAdmin'],['approve_refunds']) && (
        <NavLink to="/refund-approvals" className="sidebar-link" title={t('Refund Approvals')} style={{ display: 'flex', alignItems: 'center' }}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h14v18H5z" stroke="currentColor" strokeWidth="2"/><path d="M9 17V9M13 17v-7M17 17v-4" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Refund Approvals')}</span>
          {refundPending > 0 && (
            <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
              {refundPending}
            </span>
          )}
        </NavLink>
        )}
        {isFeatureEnabled(settings, 'modules.reports') && can(['Admin','Manager','Auditor','SuperAdmin'],['view_reports','see_reports']) && (
        <NavLink to="/reports" className="sidebar-link" title={t('Reports')}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h14v18H5z" stroke="currentColor" strokeWidth="2"/><path d="M9 17V9M13 17v-7M17 17v-4" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Reports')}</span>
        </NavLink>
        )}
        {isFeatureEnabled(settings, 'modules.backup') && can(['Admin','Manager','SuperAdmin'], ['export_tenant_data', 'import_tenant_data']) && (
        <>
          <NavLink to="/backup" className="sidebar-link" title={t('Backup')} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16v10H4V7z" stroke="currentColor" strokeWidth="2"/><path d="M8 11h8" stroke="currentColor" strokeWidth="2"/></svg>
              <span className="sidebar-text">{t('Backup')}</span>
            </span>
            {Number(offlineTotal || 0) > 0 && (
              <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                {Number(offlineTotal || 0)}
              </span>
            )}
          </NavLink>
          {can(['Admin','Manager','SuperAdmin'], ['view_imei_conflicts']) && (
          <NavLink to="/imei-conflicts" className="sidebar-link" title={t('IMEI Conflicts')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M5 20h14L12 4 5 20z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="sidebar-text">{t('IMEI Conflicts')}</span>
          </NavLink>
          )}
        </>
        )}
        <AdminGroup />
      </nav>
    </aside>
  );
}

function AdminGroup() {
  const [open, setOpen] = useState(false);
  const role = useSelector(s => s.auth.role);
  const grants = useSelector(s => s.auth.grants);
  const settings = useSelector(s => s.settings);
  const { t } = useAppLanguage();
  const allowed = (
    (isFeatureEnabled(settings, 'sections.admin') || isFeatureEnabled(settings, 'admin.audit')) && (
    ['Admin', 'SuperAdmin'].includes(role) ||
    (Array.isArray(grants) && (
      grants.includes('view_users') || grants.includes('see_users') ||
      grants.includes('view_config') || grants.includes('see_config') ||
      grants.includes('view_audit') || grants.includes('see_audit') ||
      grants.includes('view_super_bin') ||
      grants.includes('view_stock_records') || grants.includes('see_stock_records') ||
      grants.includes('view_inventory_consistency') || grants.includes('see_inventory_consistency') ||
      grants.includes('view_cashdrawer') || grants.includes('see_cashdrawer')
    ))
    )
  );
  const anyEnabled = (
    isFeatureEnabled(settings, 'admin.users') ||
    isFeatureEnabled(settings, 'admin.manual') ||
    isFeatureEnabled(settings, 'admin.docs') ||
    isFeatureEnabled(settings, 'admin.audit') ||
    isFeatureEnabled(settings, 'admin.serverLogs') ||
    isFeatureEnabled(settings, 'admin.stockRecords') ||
    isFeatureEnabled(settings, 'admin.inventoryConsistency') ||
    isFeatureEnabled(settings, 'admin.cashDrawer') ||
    isFeatureEnabled(settings, 'admin.config') ||
    isFeatureEnabled(settings, 'admin.superBin') ||
    isFeatureEnabled(settings, 'admin.godhand')
  );
  if (!allowed || !anyEnabled) return null;
  return (
    <div>
      <button className="sidebar-group-toggle" onClick={() => setOpen(o => !o)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 12a5 5 0 100-10 5 5 0 000 10z" stroke="currentColor" strokeWidth="2"/><path d="M3 22a9 9 0 0118 0" stroke="currentColor" strokeWidth="2"/></svg>
          <span className="sidebar-text">{t('Admin')}</span>
        </span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2"/>
        </svg>
      </button>
      {open && (
        <div className="sidebar-subgroup">
          {isFeatureEnabled(settings, 'admin.users') && ((Array.isArray(grants) && (grants.includes('view_users') || grants.includes('see_users'))) || ['Admin','SuperAdmin'].includes(role)) && (
          <NavLink to="/users" className="sidebar-link" title={t('Users')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 6a4 4 0 110 8 4 4 0 010-8z" stroke="currentColor" strokeWidth="2"/><path d="M4 20a8 8 0 0116 0" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Users')}</span>
          </NavLink>
          )}
          {role === 'SuperAdmin' && (
          <NavLink to="/tenants" className="sidebar-link" title={t('Tenants')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 20V8l8-4 8 4v12" stroke="currentColor" strokeWidth="2"/><path d="M9 20v-5h6v5" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Tenants')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.manual') && (
          <NavLink to="/manual" className="sidebar-link" title={t('Manual')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5z" stroke="currentColor" strokeWidth="2"/><path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Manual')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.docs') && role === 'SuperAdmin' && (
          <NavLink to="/docs" className="sidebar-link" title={t('Docs')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5z" stroke="currentColor" strokeWidth="2"/><path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Docs')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.audit') && (role === 'SuperAdmin' || (Array.isArray(grants) && (grants.includes('view_audit') || grants.includes('see_audit')))) && (
          <NavLink to="/audit" className="sidebar-link" title={t('Audit Log')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h14v18H5z" stroke="currentColor" strokeWidth="2"/><path d="M9 17V9M13 17v-7M17 17v-4" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Audit Log')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.serverLogs') && role === 'SuperAdmin' && (
          <NavLink to="/server-logs" className="sidebar-link" title={t('Server Logs')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16v12H4z" stroke="currentColor" strokeWidth="2"/><path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Server Logs')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.stockRecords') && ((Array.isArray(grants) && (grants.includes('view_stock_records') || grants.includes('see_stock_records'))) || ['Admin','SuperAdmin'].includes(role)) && (
          <NavLink to="/stock-records" className="sidebar-link" title={t('Stock Records')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2"/><path d="M7 10h10M7 14h6" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Stock Records')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.inventoryConsistency') && ((Array.isArray(grants) && (grants.includes('view_inventory_consistency') || grants.includes('see_inventory_consistency'))) || ['Admin','SuperAdmin'].includes(role)) && (
          <NavLink to="/inventory-consistency" className="sidebar-link" title={t('Inventory Consistency')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16v14H4z" stroke="currentColor" strokeWidth="2"/><path d="M8 15l3-3 2 2 3-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="sidebar-text">{t('Inventory Consistency')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.cashDrawer') && ((Array.isArray(grants) && (grants.includes('view_cashdrawer') || grants.includes('see_cashdrawer'))) || ['Admin','SuperAdmin'].includes(role)) && (
          <NavLink to="/cashdrawer" className="sidebar-link" title={t('Cash Drawer')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 7h18v10H3V7z" stroke="currentColor" strokeWidth="2"/><path d="M7 11h2M15 11h2" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Cash Drawer')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.config') && ((Array.isArray(grants) && (grants.includes('view_config') || grants.includes('see_config'))) || ['Admin','SuperAdmin'].includes(role)) && (
          <NavLink to="/config" className="sidebar-link" title={t('Config')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" strokeWidth="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0l-.06-.06A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82-.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 8.6c.37 0 .73-.13 1.02-.36l.06-.06a2 2 0 012.83 0l.06.06c.29.23.65.36 1.02.36.37 0 .73-.13 1.02-.36l.06-.06a2 2 0 012.83 2.83l-.06.06c-.23.29-.36.65-.36 1.02 0 .37.13.73.36 1.02l.06.06z" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Config')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.superBin') && ((Array.isArray(grants) && grants.includes('view_super_bin')) || ['Admin','SuperAdmin'].includes(role)) && (
          <NavLink to="/super-bin" className="sidebar-link" title={t('Super Bin')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14" stroke="currentColor" strokeWidth="2"/><path d="M9 7V5h6v2" stroke="currentColor" strokeWidth="2"/><path d="M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2"/><path d="M10 11v5M14 11v5" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('Super Bin')}</span>
          </NavLink>
          )}
          {isFeatureEnabled(settings, 'admin.godhand') && role === 'SuperAdmin' && (
          <NavLink to="/godhand" className="sidebar-link" title={t('GodHand')}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M7 7a5 5 0 0110 0v4a4 4 0 01-4 4h-1v3H9v-5H8a3 3 0 01-3-3V7z" stroke="currentColor" strokeWidth="2"/></svg>
            <span className="sidebar-text">{t('GodHand')}</span>
          </NavLink>
          )}
        </div>
      )}
    </div>
  );
}

export default Sidebar;
