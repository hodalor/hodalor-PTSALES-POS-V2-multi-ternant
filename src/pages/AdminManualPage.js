import { useRef } from 'react';
import { downloadHtmlDocument } from '../utils/exporters';

function Section({ title, children }) {
  return (
    <section className="card" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function AdminManualPage() {
  const contentRef = useRef(null);

  function downloadManual() {
    downloadHtmlDocument(
      'ptsales-system-manual.html',
      'ptSales System Manual',
      `
        <div class="doc-header">
          <h1>ptSales System Manual</h1>
          <div class="doc-muted">Operational guide for tenant admins, managers, cashiers, and support teams.</div>
        </div>
        ${contentRef.current?.innerHTML || ''}
      `
    );
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ marginTop: 0, marginBottom: 8 }}>System Manual</h1>
            <div style={{ color: '#64748b' }}>
              This guide explains how to use every major feature: what each page does, when to use it, and how newer tenant, POS, subscription, and permission controls work.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>
            <button className="btn btn-primary" type="button" onClick={downloadManual}>Download Manual</button>
          </div>
        </div>
      </div>
      <div ref={contentRef} style={{ display: 'grid', gap: 12 }}>
      <Section title="Navigation Overview">
        <ul>
          <li>Dashboard: High‑level metrics (Admin/Manager).</li>
          <li>POS: Sell items, take payments, print receipts, handle tax overrides.</li>
          <li>Invoices: Create A4 invoices (manual) and view invoice records.</li>
          <li>Sales: View historical sales, invoice and receipt numbers; reprint.</li>
          <li>Products: Create/edit products with units, attributes, packs and variants.</li>
          <li>Inventory: View stock per branch; serialized items use unit actions instead of free quantity editing.</li>
          <li>Serialized Inventory: Search unit‑level IMEI/serial records by branch, status and inventory type.</li>
          <li>Purchases: Receive stock (supports packs and variants).</li>
          <li>Transfers: Move stock between branches (supports variants).</li>
          <li>Adjustments: Correct stock up/down with remarks (supports variants).</li>
          <li>Stock Records: Unified list of all stock changes across the system, with filters and exports.</li>
          <li>Labels: Print barcode labels (products and their variants).</li>
          <li>Expenses: Record and review operational costs per branch.</li>
          <li>Suppliers & Customers: Maintain master data and contacts.</li>
          <li>Refunds: Initiate and approve refunds with two‑step verification.</li>
          <li>Refund Approvals: Manager/Admin approve refund requests and restock if needed.</li>
          <li>Finance: Cash Reconciliation for deposit backlog, company-account allocations, and approval workflow.</li>
          <li>Reports: Export sales CSV, totals by time/seller/branch.</li>
          <li>Backup & Sync: View queued offline items, run Backup Now / Sync Now.</li>
          <li>IMEI Conflicts: Review serialized offline sales that failed during sync.</li>
          <li>Docs: Technical documentation and architecture notes (SuperAdmin‑only).</li>
          <li>Users: Manage user accounts and roles.</li>
          <li>Cash Drawer: Open drawer logs and operations.</li>
          <li>Config: Store info, receipt header/footer, taxes, invoice serials, phone, website.</li>
          <li>Audit Log: Track sensitive actions (stock, sales, overrides).</li>
          <li>Server Logs: Backend diagnostics (SuperAdmin).</li>
          <li>GodHand: Feature toggle panel (SuperAdmin) to hide/show paid modules.</li>
        </ul>
      </Section>

      <Section title="Tenant Access, Subscription, and Renewal">
        <ul>
          <li>Tenant feature access now waits for tenant settings before showing menus, which prevents unauthorized pages from flashing briefly during login.</li>
          <li>Same-device tenant switching now clears business data such as users, branches, products, invoices, and other tenant records before fresh database data loads.</li>
          <li>Subscription status now appears in the top bar instead of a separate body card.</li>
          <li>When a tenant subscription is expired, payment actions appear only if at least one gateway is enabled by superadmin.</li>
          <li>If all gateways are disabled, tenants see the configured fallback message instead of Make Payment buttons.</li>
          <li>Tenant admins can edit the fallback renewal message from Config using the Subscription Payment Unavailable Message setting.</li>
          <li>Master and tenant data should remain isolated even on the same browser session because business datasets are reloaded per tenant instead of trusted from stale persisted lists.</li>
        </ul>
      </Section>

      <Section title="Dashboard – Competition, Customers, and Scope">
        <ul>
          <li>Dashboard starts each day with From and To set to today.</li>
          <li>Sales summary areas remain branch-specific by default.</li>
          <li>Cashier leaderboard and branch comparison can be widened by grants:
            <ul>
              <li>Assigned branches only</li>
              <li>All branches</li>
            </ul>
          </li>
          <li>Customer leaderboard now appears on the dashboard as a top-10 summary and can rank by amount spent or by products bought.</li>
          <li>Customers page includes a full Customer Leaderboard tab with filters for retail, distribution, or all customers.</li>
          <li>Revenue and Profit are controlled separately, so a user may be allowed to see one without the other.</li>
        </ul>
      </Section>

      <Section title="Products – Units, Attributes, Packs, Variants">
        <p><strong>When to use each option</strong></p>
        <ul>
          <li>Units:
            <ul>
              <li>Volume (mL/L): Beverages (e.g., Soda 330mL, Water 1.5L). Set unitKind=volume, unitValue=330, unitSymbol=mL.</li>
              <li>Mass (g/kg): Foods or materials (e.g., Flour 1kg). Set unitKind=mass, value and symbol.</li>
              <li>Length (mm/cm/in): Cables, rods, fabrics by length. Set unitKind=length with symbol.</li>
              <li>Size: Apparel sizes like S/M/L or labels such as “Large”. Use sizeLabel.</li>
              <li>Shoe: Numeric shoe sizes (e.g., 42 EU). Use shoeSize.</li>
              <li>None: Generic items without a measurable unit.</li>
            </ul>
          </li>
          <li>Attributes: Free‑form key/value like Model, RAM, Storage, Color. Use for devices (e.g., Laptop with Model=ThinkPad, RAM=16GB, SSD=512GB) or any extra descriptors.</li>
          <li>Packs: Unit conversions for receiving stock in bulk (e.g., Case (24) for bottled drinks). Purchases multiply pack quantity to base units automatically.</li>
          <li>Variants: Per‑option SKUs like T‑Shirt (Small/Medium/Large) or Shoe (42/43). Each variant has its own price (optional) and branch stock.</li>
          <li>Track Type:
            <ul>
              <li>Quantity: Regular products whose stock changes by numeric quantity.</li>
              <li>Serialized: Device‑style products where each unit must exist as its own IMEI or serial record.</li>
            </ul>
          </li>
        </ul>
        <p><strong>Spec display</strong></p>
        <ul>
          <li>The system builds a product spec from unit/size/shoe/attributes and shows it in Products, POS, Sales, Receipts and Labels.</li>
          <li>Variant label is appended to the base name, e.g., “T‑Shirt (Large)”.</li>
        </ul>
        <p><strong>Best practices</strong></p>
        <ul>
          <li>Pick a single base unit per product (e.g., bottles). Use Packs to define cases/crates.</li>
          <li>Use Attributes for descriptive fields; don’t overload product name.</li>
          <li>Create Variants when each option needs its own stock count or barcode/SKU.</li>
          <li>Use Serialized for phones, tablets, routers, laptops, TVs and other products that must be traced unit by unit across purchase, transfer, sale, refund and adjustment.</li>
        </ul>
      </Section>

      <Section title="Serialization Overview – Retail, Wholesale and Warehouse">
        <ul>
          <li>Serialized products do not use free manual stock quantity editing. Stock only changes through real unit actions using IMEI or serial values.</li>
          <li>Supported inventory areas:
            <ul>
              <li>Retail branch inventory.</li>
              <li>Wholesale branch inventory.</li>
              <li>Warehouse branch inventory.</li>
            </ul>
          </li>
          <li>Supported unit actions:
            <ul>
              <li>Receive units in retail, wholesale and warehouse purchases.</li>
              <li>Transfer exact units between branches and inventory types.</li>
              <li>Sell exact units in POS and wholesale POS.</li>
              <li>Refund and restock exact sold units.</li>
              <li>Adjust stock by adding scanned units or removing selected units.</li>
              <li>Inspect unit history from Serialized Inventory.</li>
            </ul>
          </li>
          <li>Unit statuses include In Stock, Reserved, Sold, Returned and Adjusted Out.</li>
          <li>Receipts and invoices now show IMEI or serial values for serialized sales.</li>
        </ul>
      </Section>

      <Section title="Expenses – Track Operational Costs">
        <ul>
          <li>Filters: Date range and Branch; totals card shows sum and record count.</li>
          <li>Add Expense: Choose Branch, Date, enter Category, Amount and optional Note, then Save.</li>
          <li>Permissions: Admin/Manager/SuperAdmin or users with the add_expenses grant can add/delete.</li>
          <li>Offline: With Backup enabled, new expenses queue when offline and show “Expenses queued”; they upload on Backup/auto‑sync.</li>
          <li>Records: Table lists Date, Branch, Category, Note, Amount; authorized users can delete.</li>
        </ul>
      </Section>

      <Section title="POS – Selling, Stock Checks, Receipts">
        <ul>
          <li>Search by name, SKU or scan barcode. Variants appear as separate items.</li>
          <li>Stock checks use the current branch and the specific variant’s stock.</li>
          <li>Retail and Distribution POS now place the search box and product display style controls on the same toolbar row for faster browsing.</li>
          <li>Quick customer creation now happens inline on the POS page using Name, Phone, and Address fields instead of a separate quick-add modal.</li>
          <li>Easy Buy and Credit Sale can be selected without a preselected customer, but Name, Phone, and Address become required before completion.</li>
          <li>When checkout creates a customer from POS, Retail POS saves a retail customer and Distribution POS saves a distribution customer automatically.</li>
          <li>Complete Payment is now locked immediately on first click to prevent duplicate customer creation and duplicate sales.</li>
          <li>Serialized POS flow:
            <ul>
              <li>Scan IMEI directly into the POS search box to reserve and add the exact unit instantly.</li>
              <li>If selling manually, open the serialized picker, scan an IMEI barcode, use camera scan, or choose a unit from the paginated unit list.</li>
              <li>Removing a serialized cart line releases its reservation automatically.</li>
              <li>Held sale, clear cart and replace-cart actions also release serialized reservations safely.</li>
            </ul>
          </li>
          <li>Discount: Apply a cart‑level discount amount.</li>
          <li>Tax override (if role allows): Enter override % and required remark; recorded in Audit Log.</li>
          <li>Payments: Add multiple methods with amounts (cash/card/mobile/wallet). System prevents completion until fully paid.</li>
          <li>Invoice Number: Auto‑generated as Prefix‑Branch‑NNNNNN (configured in Settings).</li>
          <li>Receipt Number: Auto‑generated as Prefix‑Branch‑NNNNNN; printed alongside Invoice on receipts.</li>
          <li>Receipts: Prints branded HTML receipt; offline QR embeds a local SVG; also supports ESC/POS text download.</li>
          <li>Offline: If offline, the sale is queued and syncs later. Receipt still prints, cached serialized units can still be used locally, and sync failures are logged into IMEI Conflicts for review.</li>
          <li>Held Sales: Put aside an in‑progress sale and serve the next customer.
            <ul>
              <li>States: Active (current), Held (paused), Completed (paid).</li>
              <li>Hold: Saves the current cart including items, discount, notes, customer, loyalty redeem, tax override, payment rows, and view mode; clears the cart for a new sale.</li>
              <li>Held Panel: Open “Held (N)” to see all held sales; search by label or customer; sort by newest/oldest or label; rename or delete entries.</li>
              <li>Resume: Replaces the current cart with the held sale (confirmation shown if needed) so you can continue and complete payment.</li>
              <li>Multiple held sales are supported and persist across refreshes.</li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section title="Refund Approvals – Manager/Admin">
        <ul>
          <li>Queue: Shows pending refund requests with evidence and requested amounts.</li>
          <li>Decision: Approve or Reject with an optional remark; choose restock option and quantities.</li>
          <li>Serialized refund flow:
            <ul>
              <li>Refund requests show sold IMEI or serial units for serialized sale lines.</li>
              <li>Requester can select the exact units being returned.</li>
              <li>Approver can complete full or partial restock using exact unit selections.</li>
              <li>Approved restock returns those same units to stock instead of adding anonymous quantity.</li>
            </ul>
          </li>
          <li>Audit: All approvals are recorded. Restocking increases inventory accordingly.</li>
        </ul>
      </Section>

      <Section title="Invoices – Manual (A4) and Records">
        <ul>
          <li>Tabs: “New Invoice” to create, “Invoice Records” to search and print past invoices.</li>
          <li>New Invoice:
            <ul>
              <li>Select products/variants, set Qty and Rate; tax is applied from Settings.</li>
              <li>Customer: choose an existing customer or enter ad‑hoc name/contact/address.</li>
              <li>References: Delivery Note, Payment Terms, Supplier’s Ref., Other Ref., Buyer’s Order No., Despatch Doc No., Delivery Date/Method, Destination, Terms of Delivery.</li>
              <li>Generate: Creates an A4 invoice with number = Prefix‑NNNNNN. Payment Status = UNPAID and Source = manual.</li>
              <li>Printing: A4 invoice renders immediately for print or PDF save.</li>
              <li>Offline: If offline and Backup is enabled, the invoice is queued for backup and still prints locally.</li>
            </ul>
          </li>
          <li>Invoice Records:
            <ul>
              <li>Search by number, customer, order no., supplier/other refs.</li>
              <li>Columns show Number, Customer, Date, Total, Status, Order No., with Print action.</li>
              <li>POS sales also create paid invoice records with Source = pos and Payment Status = PAID.</li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section title="Reports – Summaries & Exports">
        <ul>
          <li>Sales summaries by time, seller and branch with CSV/PDF exports.</li>
          <li>Revenue and profit visibility now follow separate grants, so one can be shown while the other stays hidden.</li>
          <li>Exports and on-screen values respect those visibility grants.</li>
          <li>All Branches filtering is supported where the user has scope to view broader branch data.</li>
          <li>Use filters and export buttons to share reports externally.</li>
        </ul>
      </Section>

      <Section title="Sales – History and Exports">
        <ul>
          <li>Lists sales with invoice serials, seller, branch and totals.</li>
          <li>Revenue and profit figures are masked independently based on the logged-in user grants.</li>
          <li>Click to view/print receipt; public receipt link is accessible from the ID.</li>
          <li>Use Sales or Reports export actions for analytics, sharing, and print-ready output.</li>
        </ul>
      </Section>

      <Section title="Users – Accounts & PIN">
        <ul>
          <li>Create, rename and delete users; set branch access as needed.</li>
          <li>Assign roles and grants for fine‑grained permissions.</li>
          <li>Revenue and profit are separate grants, so you can allow one without the other.</li>
          <li>Tenant user grant screens now show those visibility grants under tenant permissions as well, not only for superadmin.</li>
          <li>Reset PIN from Users page or via the Login screen’s Admin Reset PIN flow.</li>
        </ul>
      </Section>

      <Section title="Docs – Technical Reference">
        <ul>
          <li>SuperAdmin‑only page with architecture notes, PWA/offline details, and code references.</li>
          <li>Useful for onboarding and troubleshooting advanced topics.</li>
        </ul>
      </Section>
      <Section title="Inventory – Branch & Variants">
        <ul>
          <li>Choose branch to view/edit stock levels.</li>
          <li>If a product has variants, click “Variants” to edit per‑variant stock for the branch.</li>
          <li>Modal shows branch breakdown and a dedicated “Variants (current branch)” editor.</li>
          <li>Serialized protection:
            <ul>
              <li>Manual stock quantity editing is blocked for serialized products.</li>
              <li>Inventory detail panels label serialized totals separately for retail, wholesale and warehouse.</li>
              <li>Use Purchases, Transfers, POS, Refunds, Adjustments, or Serialized Inventory workflows to change serialized stock.</li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section title="Purchases – Receive Stock with Packs & Variants">
        <ul>
          <li>Select Product → Variant (if any) → Pack (e.g., Case (24)) → Quantity to receive.</li>
          <li>System converts Pack × Qty to base units and increments that branch/variant stock.</li>
          <li>Audit Log records supplier, cost, chosen pack and conversion factor.</li>
          <li>Serialized purchase flow:
            <ul>
              <li>Retail Purchases, Wholesale Purchase, and Warehouse Purchase all support IMEI or serial receiving.</li>
              <li>Quantity is not typed manually for serialized products; it is derived from scanned or entered IMEI lines.</li>
              <li>Use hardware barcode scanners, camera scan, manual typing, or pasted multiline lists.</li>
              <li>Batch Mode keeps focus on the scan field so many manufacturer-labeled boxes can be scanned quickly.</li>
              <li>Approval creates real unit records in the correct retail, wholesale or warehouse inventory area.</li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section title="Transfers – Move Stock Between Branches">
        <ul>
          <li>Select Product → Variant (if any) → From/To Branch → Quantity → Transfer.</li>
          <li>Audit Log records who transferred, from/to branches, variant and quantity.</li>
          <li>Serialized transfer flow:
            <ul>
              <li>Source branch unit lists show available IMEI or serial records for the chosen product.</li>
              <li>User selects the exact units to move; selected units determine the effective quantity.</li>
              <li>This works for retail, wholesale, and warehouse transfer requests.</li>
              <li>Approval moves the selected unit IDs and updates stock correctly at both ends.</li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section title="Adjustments – Correct Stock">
        <ul>
          <li>Select Product → Variant (if any) → Branch → Quantity → Adjustment Type → Apply with a required reason and remark.</li>
          <li>Use for corrections, write‑offs or cycle count differences. All actions are audited.</li>
          <li>Damaged/Expired Removal: Use the dedicated removal tool to subtract a quantity with a reason; this records an audit entry and updates branch stock.</li>
          <li>Serialized adjustment flow:
            <ul>
              <li>Add Units: scan or enter IMEI or serial numbers; quantity is derived from the unit count.</li>
              <li>Remove Units: search the current branch list and select the exact units to remove.</li>
              <li>Removed units are marked Adjusted Out so they remain traceable in Serialized Inventory.</li>
              <li>The same serialized rules apply in retail, wholesale and warehouse adjustment flows.</li>
            </ul>
          </li>
          <li>Approvals: Staff submit Adjustment Requests; Managers/Admins with the approve_adjustments grant review in the Approvals tab and Approve/Reject with a remark.</li>
        </ul>
      </Section>

      <Section title="Cash Reconciliation – Finance Workflow">
        <ul>
          <li>Use Finance → Cash Reconciliation to match branch sales to company-account deposits.</li>
          <li>Backlog & Submit:
            <ul>
              <li>Select a branch and backlog dates with real sales that are not yet deposited.</li>
              <li>Expected amount is calculated automatically from the selected sales dates.</li>
              <li>The total entered across all allocations must exactly equal the expected amount.</li>
            </ul>
          </li>
          <li>Allocations:
            <ul>
              <li>Split one reconciliation across multiple company accounts and payment methods.</li>
              <li>Upload proof of deposit for each allocation.</li>
            </ul>
          </li>
          <li>Approvals:
            <ul>
              <li>Rows open a detail modal for full review.</li>
              <li>Approver must enter a remark before approval or rejection.</li>
              <li>Balances only update after the proper approval stage is completed.</li>
            </ul>
          </li>
          <li>Records and cards show deposited totals, awaiting deposit, pending approval, and backlog days.</li>
        </ul>
      </Section>

      <Section title="Serialized Inventory – Unit Lookup and Audit">
        <ul>
          <li>Use Serialized Inventory to search unit‑level stock by IMEI, serial number, product, branch, inventory type and status.</li>
          <li>Status filters include In Stock, Reserved, Sold, Returned and Adjusted Out.</li>
          <li>Use the page to confirm where a unit currently lives before transfer, sale, refund or adjustment.</li>
          <li>Pagination is available for large result sets.</li>
        </ul>
      </Section>

      <Section title="Wholesale and Warehouse Serialization">
        <ul>
          <li>Wholesale and warehouse flows follow the same serialized rule as retail: stock changes only from actual IMEI or serial unit actions.</li>
          <li>Wholesale Purchase and Warehouse Purchase:
            <ul>
              <li>Receive serialized units by scan, camera scan, manual entry or batch paste.</li>
              <li>Approval creates unit records under the selected wholesale or warehouse branch.</li>
            </ul>
          </li>
          <li>Wholesale Transfer and Warehouse Transfer:
            <ul>
              <li>Load available unit records from the source area.</li>
              <li>Select exact IMEIs or serials to move.</li>
            </ul>
          </li>
          <li>Wholesale and Warehouse Adjustments:
            <ul>
              <li>Positive adjustments add stock only by entering new units.</li>
              <li>Negative adjustments remove stock only by selecting existing units.</li>
            </ul>
          </li>
          <li>Manual quantity edits remain blocked for serialized products in both areas.</li>
        </ul>
      </Section>

      <Section title="Labels – Print Barcodes">
        <ul>
          <li>Search/select products or variants; set copy count; print grid‑formatted labels.</li>
          <li>If a variant has its own SKU/barcode, it prints that; otherwise prints base product barcode.</li>
        </ul>
      </Section>

      <Section title="Cash Drawer – Sessions and Drawer Control">
        <ul>
          <li>Open Session: Enter opening float on the Cash Drawer page and open the session at shift start.</li>
          <li>Record Movements: Use “Cash In” for deposits and “Cash Out” for payouts; include notes for auditing.</li>
          <li>Expected Cash: The page shows Opening Float + In − Out; compare during close.</li>
          <li>Close Session: When ending the shift, close to lock entries and preserve totals.</li>
          <li>Open Drawer Now: Use the “Open Drawer Now” button to generate a tiny ESC/POS file that pulses the drawer immediately, without affecting automatic open‑on‑sale settings.</li>
          <li>Physical Drawer: When configured in Config and using cash payments, the drawer open command is also included with ESC/POS output at POS completion.</li>
          <li>Persistence: Sessions and movements are stored in Atlas; reloading the page restores your open session automatically.</li>
        </ul>
      </Section>

      <Section title="Refunds – Two‑Step Verification">
        <ul>
          <li>Search: Enter either Receipt Number or Invoice Number to locate the sale.</li>
          <li>Evidence: Upload at least two images and enter a remark explaining the return.</li>
          <li>Type: Choose Full (eligible = Total − Tax) or Partial (enter amount ≤ eligible).</li>
          <li>Restock: For full or partial refunds, approver can choose No/Full/Partial restock with quantities.</li>
          <li>Approval: Cashier/Manager/Admin can initiate; approval required by Manager/Admin (not the initiator). Approver submits a decision with an optional remark.</li>
          <li>Effect: Upon approval, revenue is reduced by the approved amount and, if selected, stock is increased for the returned items.</li>
        </ul>
      </Section>

      <Section title="Suppliers & Customers">
        <ul>
          <li>Add and edit contacts for purchasing and sales.</li>
          <li>Confirmation dialogs use the system modal (no browser alerts).</li>
        </ul>
      </Section>

      <Section title="Config – Company & Receipt Settings">
        <ul>
          <li>App/Store: Name, website, phone, receipt header/footer.</li>
          <li>Taxes: Default tax rate. Roles may override at POS with remark (audited).</li>
          <li>Invoice: Prefix and next number. System increments after each completed sale.</li>
          <li>Receipt: Prefix and next number. System increments after each completed sale.</li>
          <li>QR: Offline QR generation embedded into receipts (no external service).</li>
          <li>PWA: Install App button appears when eligible; SuperAdmin/Admin can also install from Config “App Installation (PWA)”.</li>
          <li>Branding: Client App Name and Client App Logo control top bar and PWA install name/icon; fallbacks ensure logo displays even if custom fails.</li>
          <li>Currency: Manage supported currencies and active currency; symbols and positions apply across POS, Dashboard, Cash Drawer, Inventory and receipts.</li>
          <li>PAID Stamp: Configure whether a “PAID” stamp appears on A4 invoices for POS sales, along with label text, centering, thank‑you line, date, and color.</li>
          <li>Background Refresh: Control the auto‑refresh interval for lists such as products, suppliers, customers, branches, refunds and sales.</li>
          <li>Subscription Payment Unavailable Message: Superadmin or tenant admin can define the message shown when online renewal gateways are all disabled.</li>
        </ul>
      </Section>

      <Section title="Backup & Sync – Offline Queue">
        <ul>
          <li>Backup & Sync page shows totals per collection (Sales, Invoices, Customers, etc.) and pending counts.</li>
          <li>Backup Now: Attempts to upload all queued items when online. If you logged in offline, you’ll be prompted for your PIN to obtain a token before backup.</li>
          <li>Sync Now: Refreshes the local data from the server when online.</li>
          <li>Indicators: “Queued” badges appear on pages (e.g., POS) and link to the Backup page.</li>
          <li>Auto‑sync: When online and Backup is enabled, background sync uploads queued items automatically.</li>
          <li>IMEI Conflicts page shows serialized offline sales that later failed on sync, so staff can review the affected units.</li>
        </ul>
      </Section>

      <Section title="Audit Log – Compliance">
        <ul>
          <li>Tracks stock receives, transfers, adjustments, tax overrides, sale completions, refund approvals, and cash drawer events.</li>
          <li>Filter and export as needed for reviews.</li>
          <li>Data is pulled from the server in the background for up‑to‑date results.</li>
        </ul>
      </Section>

      <Section title="Stock Records – Unified Changes">
        <ul>
          <li>Scope: Consolidates stock changes from Purchases (receive), Transfers, Adjustments (incl. damage/expiry), Inventory manual set, Products initial stock, POS sales (stock deduct), and Refund Approvals (restock).</li>
          <li>Filters: Date range, Actor, Branch, Source page.</li>
          <li>Columns: Timestamp, Actor, Branch, Source, Action, Product, Variant, Delta, Remark.</li>
          <li>Exports: CSV and print‑to‑PDF for filtered results; use page header buttons.</li>
          <li>Pagination: Change rows per page (10/25/50/100) and page through results.</li>
          <li>For serialized products, combine Stock Records with Serialized Inventory for both quantity summary and exact unit traceability.</li>
        </ul>
      </Section>

      <Section title="Exports & Pagination">
        <ul>
          <li>Records pages (Sales, Refunds, Refund Approvals, Purchases, Transfers, Stock Records) now include CSV and PDF exports for the filtered dataset.</li>
          <li>Use the Export CSV/PDF buttons at the top of each table.</li>
          <li>Pagination controls appear below tables with page navigation and rows‑per‑page selector.</li>
          <li>PDF uses a print‑friendly view; use your browser’s “Save as PDF”.</li>
        </ul>
      </Section>

      <Section title="Roles & Access">
        <ul>
          <li>Admin: Full access, including Users, Config, Audit Log.</li>
          <li>Manager: POS, Inventory, Reports; may see Dashboard.</li>
          <li>Inventory Staff: Products, Inventory, Purchases, Transfers, Adjustments, Labels.</li>
          <li>Cashier: POS, Sales, Cash Drawer, Customers.</li>
          <li>SuperAdmin: All Admin features plus Server Logs.</li>
        </ul>
      </Section>

      <Section title="Reset PIN (Password Reset)">
        <ul>
          <li>This system uses a numeric PIN (4–6 digits) instead of an email password.</li>
          <li>Only Admin/SuperAdmin can reset a user PIN.</li>
          <li>From the login screen: click “Reset PIN (Admin)” → enter Admin username + Admin PIN → enter the username to reset → set the new PIN → Reset.</li>
          <li>From the Users page: open Admin → Users → edit the user → enter “New PIN” → save changes.</li>
        </ul>
      </Section>

      <Section title="GodHand – Feature Gating (SuperAdmin)">
        <ul>
          <li>Purpose: Hide/show modules, admin menus, and selected tabs based on what a company has paid for.</li>
          <li>Location: Admin → GodHand (SuperAdmin only).</li>
          <li>Effect: Disabled features are removed from the sidebar and blocked by routes (direct URL access is prevented).</li>
          <li>Coverage includes retail menus, distribution and warehouse menus, finance screens, serialized inventory, docs/manual pages, admin tools, runtime tabs, and grant-backed visibility items such as dashboard competition and revenue/profit access.</li>
          <li>Recommendation: Enable only the modules the customer is subscribed to; keep core navigation (like POS) enabled.</li>
        </ul>
      </Section>
      
      <Section title="Grants – Fine‑Grained Permissions">
        <ul>
          <li>Per‑user grants supplement roles. Assign on the Users page.</li>
          <li>Stock Ops: add_purchases, add_transfers, add_adjustments control receiving, transfers and adjustments buttons and APIs.</li>
          <li>Refunds: approve_refunds allows non‑Manager/Admin to approve if granted.</li>
          <li>Financial visibility is split into view_revenue and view_profit, with older view_financials kept only for backward compatibility.</li>
          <li>Changes apply immediately; background refresh keeps the UI consistent.</li>
        </ul>
      </Section>
      
      <Section title="Server Logs – Backend Diagnostics">
        <ul>
          <li>SuperAdmin‑only. Navigate to Server Logs to view recent backend entries.</li>
          <li>Columns include timestamp, level, actor, route, status, message, error code and meaning; stack is available on hover.</li>
          <li>Use Refresh or rely on auto‑refresh; export CSV/PDF for sharing.</li>
        </ul>
      </Section>

      <Section title="Troubleshooting & Tips">
        <ul>
          <li>Variants: Use when stock differs per option; give SKUs for scanning.</li>
          <li>Packs: Define the most common bulk receive units to save time.</li>
          <li>Receipts: Keep phone and footer updated in Config for customer clarity.</li>
          <li>Offline: Sales queue automatically and sync when back online or via Backup; offline login allows continued operation without internet.</li>
          <li>IMEI Conflicts: If a serialized offline sale fails during sync, review IMEI Conflicts before trying to sell the same device again.</li>
          <li>Barcode Scanning: Hardware scanners should be configured to act like keyboard input and send Enter after each scan.</li>
          <li>Serialized Stock: Never correct serialized stock by typing a quantity; add or remove the real units instead.</li>
          <li>Install: If the Install button isn’t available, use the browser’s “Install App” menu; once installed, the Config button will open the installed app and apply updates.</li>
        </ul>
      </Section>
      </div>
    </div>
  );
}

export default AdminManualPage;
