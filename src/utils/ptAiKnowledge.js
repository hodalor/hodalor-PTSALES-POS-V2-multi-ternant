const TYPO_REPLACEMENTS = [
  [/ser[ia]*l[ie]s?e?d?/g, 'serialized'],
  [/ime\b/g, 'imei'],
  [/aj[u]?s?t?m?e?n?t?/g, 'adjustment'],
  [/pucha?s?e?/g, 'purchase'],
  [/wareh?o?u?s?e?/g, 'warehouse'],
  [/distr?i?b?u?t?i?o?n?/g, 'distribution'],
  [/custmer|customerr/g, 'customer'],
  [/branah|brnach|barch/g, 'branch'],
  [/tranf?er|trasfer/g, 'transfer'],
  [/supp?l?i?e?r?/g, 'supplier']
];

export const PT_AI_TOPICS = [
  {
    id: 'serialized-add',
    title: 'How To Add A Serialized Or IMEI Item',
    keywords: ['serialized', 'imei', 'serial', 'phone', 'device', 'product unit', 'how to add serial', 'how to add imei', 'how to phone imei'],
    answer: [
      'Go to Products and create or edit the product.',
      'Set the product tracking type to Serialized so the system treats each unit separately.',
      'After that, bring stock in through Purchase, Warehouse Purchase, or Distribution Purchase so the units enter the right inventory area.',
      'For an existing serialized product, open the product unit tools or serialized receiving flow and paste one IMEI or serial per line.',
      'Use Serialized Inventory to confirm the unit is now in stock under the correct branch and inventory type.'
    ]
  },
  {
    id: 'sell-serialized',
    title: 'How To Sell A Serialized Phone Or IMEI Item',
    keywords: ['sell phone', 'sell imei', 'serialized sale', 'serial number sale', 'phone imei'],
    answer: [
      'Open POS or Distribution POS depending on the inventory type you are selling from.',
      'Search by product name, IMEI, or serial number.',
      'Select the exact serialized unit so the system removes that individual device from stock.',
      'Complete payment normally and check the receipt or invoice if you need the IMEI shown.'
    ]
  },
  {
    id: 'purchase-stock',
    title: 'How To Make A Retail Purchase',
    keywords: ['purchase', 'retail purchase', 'make purchase', 'add stock', 'receive stock', 'goods received', 'how to make purchases'],
    answer: [
      'Open Retail then Purchases from the sidebar.',
      'Click Add Purchase to open the purchase entry modal.',
      'Choose the retail branch and supplier, then search and select the product by name, SKU, or barcode.',
      'Enter cost, quantity, pack or variant details where needed. If the product is serialized, enter or scan the IMEI or serial lines instead of typing anonymous quantity.',
      'Add the item to the request list, review the lines, then save or submit the purchase.',
      'If your approval flow is enabled, wait for approval. After approval, the retail branch stock increases automatically.'
    ]
  },
  {
    id: 'distribution-purchase',
    title: 'How To Make A Distribution Purchase',
    keywords: ['distribution purchase', 'wholesale purchase', 'make distribution purchase', 'receive distribution stock'],
    answer: [
      'Open Distribution then Distribution Purchase.',
      'Choose the distribution branch and supplier, then search for the product by name, SKU, or barcode.',
      'Select the matching item, enter quantity, cost, and any pack details.',
      'For serialized items, scan or paste the IMEI or serial numbers so the quantity comes from the unit list.',
      'Save the request and follow the approval flow if your tenant requires it.',
      'When approved, the stock is added to the selected distribution branch.'
    ]
  },
  {
    id: 'warehouse-purchase',
    title: 'How To Make A Warehouse Purchase',
    keywords: ['warehouse purchase', 'make warehouse purchase', 'receive warehouse stock'],
    answer: [
      'Open Warehouse then Warehouse Purchase.',
      'Pick the warehouse branch and supplier, then search and choose the product you want to receive.',
      'Enter the quantity and cost. Use pack conversion if the item is received in cartons or cases.',
      'If the item is serialized, scan or paste the IMEI or serial numbers instead of using anonymous quantity.',
      'Submit the warehouse purchase and complete the required approval stage.',
      'Once approved, the stock appears under the selected warehouse branch.'
    ]
  },
  {
    id: 'transfer-stock',
    title: 'How To Make A Transfer',
    keywords: ['transfer', 'move stock', 'retail to warehouse', 'warehouse to distribution', 'cross inventory transfer', 'how to make transfer'],
    answer: [
      'Open the transfer page that matches where the stock is currently located, such as Retail Transfers, Distribution Transfer, or Warehouse Transfer.',
      'Click Add Transfer, then choose the source branch, destination branch, and search for the product by name, SKU, or barcode.',
      'Select the correct item and enter the transfer quantity. For serialized products, select the exact unit records instead of typing a free quantity.',
      'Review the transaction lines and save the transfer request.',
      'If approval is required, let the manager or director approve it.',
      'After approval, stock is deducted from the source branch and credited to the destination branch or inventory type.'
    ]
  },
  {
    id: 'adjustments',
    title: 'How To Make An Adjustment',
    keywords: ['adjustment', 'increase stock', 'decrease stock', 'damage remove', 'stock correction'],
    answer: [
      'Open the correct adjustment page for Retail, Distribution, or Warehouse from the sidebar.',
      'Click Add Adjustment, then choose the branch and search for the product by name, SKU, or barcode.',
      'Enter the quantity and choose whether the stock should increase or decrease.',
      'Select the reason, add the required remark, and review the request before saving.',
      'For serialized items, add stock by entering new unit identifiers or remove stock by selecting the actual existing units.',
      'After approval, the stock change is applied to the correct branch and inventory type.'
    ]
  },
  {
    id: 'refunds',
    title: 'How Refunds Return Stock',
    keywords: ['refund', 'return item', 'refund approval', 'restock refund'],
    answer: [
      'Create the refund request from the correct refund page.',
      'Attach the required evidence and remark.',
      'When the refund is approved, the stock goes back into the correct branch and inventory type.',
      'Serialized items are returned as unit records, not just quantity numbers.'
    ]
  },
  {
    id: 'expense-request',
    title: 'How To Request An Expense',
    keywords: ['request expense', 'how to request expense', 'add expense', 'record expense', 'expense request'],
    answer: [
      'Open Expense then Expenses from the sidebar.',
      'Click Add Expense to open the expense form.',
      'Fill Branch, Date, Category, Amount, and Note.',
      'Click Save to submit the expense request. If you are offline and backup is enabled, the expense is queued and uploaded later.',
      'The request then appears in the expense records and can move through the approval flow when required.'
    ]
  },
  {
    id: 'expense-approval',
    title: 'How To Approve An Expense',
    keywords: ['expense approval', 'approve expense', 'expense approvals'],
    answer: [
      'Open Expense then Expense Approvals.',
      'Find the pending request and open or review the row details.',
      'Check the branch, category, amount, date, and supporting note before deciding.',
      'Enter the required remark, then use the approval action to approve or reject the expense.',
      'After approval, the request leaves the pending queue and the final status is recorded.'
    ]
  },
  {
    id: 'cash-reconciliation',
    title: 'How To Record Cash Reconciliation',
    keywords: ['cash reconciliation', 'finance', 'deposit', 'bank', 'backlog', 'proof of deposit'],
    answer: [
      'Open Finance then Cash Reconciliation.',
      'Use the Backlog & Submit tab, then click Add Reconciliation.',
      'Select the branch with backlog sales. The page loads the unreconciled sales dates automatically, and you can use Refresh Dates if needed.',
      'Choose the dates you want to deposit. The expected amount is calculated from those exact sales dates.',
      'Add one or more allocations by choosing the company account, payment method, amount, and Proof of Deposit for each line. Use Add Another Allocation when one deposit must be split.',
      'Make sure the total entered amount matches the expected amount exactly, then click Submit for Approval.'
    ]
  },
  {
    id: 'pos-checkout',
    title: 'How To Complete A Sale In POS',
    keywords: ['pos checkout', 'complete sale', 'complete and print', 'complete escpos', 'held sales', 'hold sale', 'add payment', 'quick customer'],
    answer: [
      'Open POS from the sidebar and search for the item by name, SKU, barcode, IMEI, or serial where supported.',
      'Click the product card or list row to add it to the Cart.',
      'Use the Customer area to search and Select an existing customer, or fill the quick customer fields for Customer name, Phone number, and Address.',
      'Review the cart, adjust Manual discount if needed, then add payment rows with Add Payment or switch to EasyBuy or Credit Sale when allowed.',
      'Use Hold if you want to pause the current cart, and use Held (N) to Resume a held sale later.',
      'Click Complete & Print for the normal receipt flow or Complete (ESC/POS) for the ESC/POS print file flow.'
    ]
  },
  {
    id: 'sales-records',
    title: 'How To Find Sales Records',
    keywords: ['sales record', 'sales history', 'find sale', 'sales page', 'search sales'],
    answer: [
      'Open Sales from the sidebar.',
      'Use the top buttons to stay on Sales, or switch to Sales Rep Leaderboard or Branch Comparison when you need analysis instead of row records.',
      'Use Branch, Period, From, To, Sale Type, and Credit Type to narrow the list. Users with wider scope can also use All Branches.',
      'Review the row that matches the sale. It shows invoice serial, seller, branch, and totals.',
      'Click Reprint to print the receipt again, or click ESC/POS to download the text receipt file.',
      'Use Export CSV or Export PDF when you want to download the filtered sales list.'
    ]
  },
  {
    id: 'manual-invoices',
    title: 'How To Create And Find Invoices',
    keywords: ['create invoice', 'invoice records', 'manual invoice', 'find invoice'],
    answer: [
      'Open Invoices from the sidebar.',
      'Use New Invoice to create a fresh invoice, or Invoice Records to search past invoice rows.',
      'On New Invoice, search with Search name, SKU or scan barcode, click Add on the product you want, then adjust Qty and Rate on the line items.',
      'Choose an existing customer or enter ad-hoc Name, Contact, and Address, then fill optional references such as Delivery Note, Payment Terms, Other Ref., Buyer Order No., and Destination when needed.',
      'If your page allows multiple selling prices, choose the Invoice Price Tier first so product rates follow the selected tier.',
      'Click Generate Invoice (A4) when the lines are complete.',
      'To find older invoices, switch to Invoice Records, search by number, customer, order no., or supplier or other refs, then use Print on the matching row.'
    ]
  },
  {
    id: 'products-setup',
    title: 'How To Add Products',
    keywords: ['add product', 'create product', 'product setup', 'sku barcode'],
    answer: [
      'Open Products from the sidebar.',
      'Click Add Product and enter the main details such as name, SKU, barcode, prices, cost, and category.',
      'If the item uses variants, packs, or attributes, add them in the product form before saving.',
      'If the item should be tracked one unit at a time, set it to Serialized tracking.',
      'Save the product, then use purchases or other stock flows to put quantity into the correct branches.'
    ]
  },
  {
    id: 'inventory-view',
    title: 'How To Check Inventory',
    keywords: ['inventory page', 'check stock', 'view inventory', 'branch stock'],
    answer: [
      'Open Inventory from the sidebar.',
      'Choose the branch you want to inspect so the page loads the stock for that branch.',
      'Search for the product by name, SKU, or barcode to narrow the list quickly.',
      'For variant products, open the variant details to inspect per-variant stock.',
      'For serialized products, use Serialized Inventory when you need the exact IMEI or serial unit records.'
    ]
  },
  {
    id: 'serialized-inventory-help',
    title: 'How To Use Serialized Inventory',
    keywords: ['serialized inventory', 'imei records', 'serial records', 'find imei'],
    answer: [
      'Open Serialized Inventory from the sidebar.',
      'Use the search field to enter the IMEI, serial number, product, or related value you want to trace.',
      'Add branch, inventory type, or status filters if you want to narrow the result further.',
      'Review the row to see whether that exact unit is in stock, sold, returned, or adjusted out.',
      'Use this page before selling, transferring, refunding, or adjusting serialized items when you need the exact unit history.'
    ]
  },
  {
    id: 'labels-printing',
    title: 'How To Print Product Labels',
    keywords: ['print labels', 'barcode stickers', 'labels page'],
    answer: [
      'Open Labels from the sidebar.',
      'Search and select the product or variant you want to print.',
      'Set the number of copies and choose the layout or format you want.',
      'Preview the labels if needed, then print them.',
      'Use this for barcode stickers, shelf labels, or packaging labels.'
    ]
  },
  {
    id: 'credit-sale-help',
    title: 'How To Use Credit Sale Menus',
    keywords: ['credit sale', 'easy buy', 'repayment approvals', 'defaulters', 'good clients'],
    answer: [
      'Open Credit Sale from the sidebar.',
      'Use Credit Sale Control for the main working screen, then use the section buttons Client Ranking, Active Sales, and Repayments inside that page.',
      'Use Period, From, To, Branch, and Credit Source to filter by All Sources, Retail EasyBuy, or Distribution Credit Sale.',
      'On Active Sales, click Repayment on the row you want, then enter Repayment amount and Repayment remark when prompted.',
      'Use the separate Good Clients and Defaulters sidebar pages when you want filtered customer ranking views only.',
      'Open Credit Sale Repayment Approvals when repayments need manager or director action, then use Pending Director, Pending Manager, Approved, or Rejected to view the correct queue.',
      'If you create a credit sale from POS, make sure the required customer details are captured before completing the sale.'
    ]
  },
  {
    id: 'dashboard-scope',
    title: 'How Dashboard Branch Scope Works',
    keywords: ['dashboard branch', 'all branches dashboard', 'leaderboard', 'branch comparison', 'competition'],
    answer: [
      'Dashboard summary cards default to today and your current branch scope.',
      'Leaderboard and branch comparison can expand wider only when the user has the correct competition grants.',
      'Those grants can allow assigned-branch scope or all-branch scope.'
    ]
  },
  {
    id: 'customer-leaderboard',
    title: 'How Customer Leaderboard Works',
    keywords: ['customer leaderboard', 'top customers', 'amount spent', 'products bought'],
    answer: [
      'Dashboard shows a top 10 customer leaderboard summary.',
      'Customers page has a dedicated Customer Leaderboard tab for full rankings.',
      'You can rank by amount spent or by products bought and filter retail, distribution, or all customers.'
    ]
  },
  {
    id: 'users-grants',
    title: 'How To Create Users And Give Access',
    keywords: ['user', 'grant', 'permission', 'role', 'cashier access'],
    answer: [
      'Open Admin then Users.',
      'In Create User, enter username, PIN, and choose the Role.',
      'Use Assign to all branches or choose the main branch and Assign additional branches when the user should not see every branch.',
      'Use the Feature Access section to tick the exact permissions the user should have.',
      'Enter Remark (required), then click Add User.',
      'Use Edit on an existing user to change their role, status, branch access, PIN, and grants later.'
    ]
  },
  {
    id: 'branch-assignment',
    title: 'How Branch Assignment Works For Users',
    keywords: ['assigned branch', 'user branch', 'branch switch', 'cashier branch', 'only one branch'],
    answer: [
      'Assign the user to the correct home branch and, if needed, extra allowed branches in Users.',
      'Cashiers and branch-limited users only see the branch data they are assigned to.',
      'Managers and admins may switch branches when their role and grants allow it.',
      'If the user should see all branches, give the proper branch-wide grants instead of leaving branch assignment unclear.'
    ]
  },
  {
    id: 'approvals-center',
    title: 'How Approvals Work',
    keywords: ['approval', 'director approval', 'manager approval', 'approve request', 'rejection remark'],
    answer: [
      'Approvals Center collects requests that need director or manager action.',
      'Open the request row to review the details, quantities, branch, reason, and attached evidence where available.',
      'Enter the required remark before approving or rejecting.',
      'Once the final approval stage completes, the system applies the stock or financial effect for that workflow.'
    ]
  },
  {
    id: 'godhand',
    title: 'What GodHand Does',
    keywords: ['godhand', 'feature toggle', 'hide menu', 'disable module'],
    answer: [
      'GodHand is the superadmin feature-toggle panel.',
      'It hides or shows system modules, menus, admin tools, and paid capabilities.',
      'If a feature is turned off there, it disappears from the sidebar and is also blocked by route checks.'
    ]
  },
  {
    id: 'reports',
    title: 'How To Export Reports',
    keywords: ['report', 'export csv', 'export pdf', 'analytics'],
    answer: [
      'Open Reports from the sidebar.',
      'Choose Period, From, To, Branch, and Report Type at the top first.',
      'Use Branch with All Branches when you want a broader scope and your access allows it.',
      'Set Report Type to the area you want, such as sales, purchases, transfers, adjustments, stock records, refunds, warehouse operations, or stock snapshots.',
      'Scroll to the matching report card and click Export CSV or Export PDF on that section.',
      'Revenue and profit visibility still follow the user grants.'
    ]
  },
  {
    id: 'customers',
    title: 'How To Add Customers Quickly',
    keywords: ['customer', 'add customer', 'pos customer', 'quick customer'],
    answer: [
      'You can add customers directly from Customers page or quickly from POS during checkout.',
      'Retail POS saves them as retail customers and Distribution POS saves them as distribution customers.',
      'Name, phone, and address are the key fast-entry fields when customer details are needed for sale completion.',
      'In POS, search the customer first, or fill Customer name, Phone number, and Address in the quick customer section when no saved customer is selected.'
    ]
  },
  {
    id: 'suppliers-page',
    title: 'How To Add Suppliers',
    keywords: ['add supplier', 'suppliers page', 'create supplier'],
    answer: [
      'Open Partners then Suppliers.',
      'Use Search suppliers when you first want to check whether the supplier already exists.',
      'Enter Name (required), Contact person, Phone, Email, Address, and Notes.',
      'Click Add Supplier to save the record so it becomes selectable in purchase flows.',
      'If only the name is known during purchase, you can create the supplier quickly first and complete the other details later.'
    ]
  },
  {
    id: 'customers-page',
    title: 'How To Add Customers From Customers Page',
    keywords: ['add customer page', 'customers page', 'create customer'],
    answer: [
      'Open Partners then Customers.',
      'Click Add Customer to open the customer modal.',
      'Use the Profile tab to enter the main fields such as name, phone, email, customer type, and address.',
      'Add business details such as Business Name, Registration Number, Tax ID, Business Phone, Business Email, and Business Address when available.',
      'You can also attach Photo, ID Front, ID Back, and Business Certificate files.',
      'Click Save Customer to create the record so it can be used later in POS, invoices, or receipts.'
    ]
  },
  {
    id: 'products',
    title: 'How To Set Up Products, Packs, And Variants',
    keywords: ['product', 'pack', 'variant', 'attribute', 'sku', 'barcode'],
    answer: [
      'Create the base product with SKU, barcode, price, and cost.',
      'Use attributes for searchable extra details like brand or color.',
      'Use packs when the same item is sold in multiples such as carton sizes.',
      'Use variants when one product has different sizes or options with separate stock and pricing.'
    ]
  },
  {
    id: 'suppliers',
    title: 'How Supplier Saving Works',
    keywords: ['supplier', 'create supplier', 'purchase supplier', 'save supplier fast'],
    answer: [
      'You can create suppliers directly from Suppliers page or from purchasing flows when only the supplier name is known.',
      'If a typed supplier already exists, select it from the suggestion list.',
      'If it is new, save with the available basic details first and complete the remaining profile later in Suppliers.'
    ]
  },
  {
    id: 'inventory',
    title: 'How Inventory And Branch Segregation Work',
    keywords: ['inventory', 'retail stock', 'distribution stock', 'warehouse stock', 'segregation'],
    answer: [
      'Retail, distribution, and warehouse stock are stored separately.',
      'The branch type decides which inventory map is used during purchase, transfer, adjustment, refund, and manual stock actions.',
      'This prevents one inventory type from accidentally changing another.'
    ]
  },
  {
    id: 'stock-records',
    title: 'How To Trace Stock Changes',
    keywords: ['stock record', 'inventory history', 'why stock changed', 'audit stock'],
    answer: [
      'Use Stock Records when you need to trace how quantity changed over time.',
      'Look for the branch, source document, user, and action type such as purchase, transfer, adjustment, refund, or sale.',
      'This helps explain why stock increased, decreased, or moved between branches.'
    ]
  },
  {
    id: 'invoice-receipt',
    title: 'How To Access Sales Receipts And Invoice Records',
    keywords: ['invoice', 'receipt', 'receipt record', 'sales record', 'reprint receipt', 'download receipt', 'access receipt', 'print sales receipt', 'invoice records', 'where is receipt'],
    answer: [
      'To access past receipt records for sales, open Sales from the sidebar.',
      'Stay on the Sales tab and use the branch, date, and other filters to find the exact sale record you want.',
      'Look at the row for that sale. The table shows details such as invoice serial, seller, branch, and total.',
      'Click the Reprint button on the sale row to open and print the receipt again.',
      'If you want a printer-friendly text file instead, use the download action next to Reprint for the ESC/POS receipt output.',
      'If you need invoice-style records, open the Invoices page and use the Invoice Records tab to search, open, print, or save previous invoice records.'
    ]
  },
  {
    id: 'backup-sync',
    title: 'How Backup And Sync Work',
    keywords: ['backup', 'sync', 'offline', 'queue', 'imei conflicts'],
    answer: [
      'Open Backup from the sidebar when you want to review queued offline records.',
      'Use the collection buttons on the left to open the queue you want, such as sales, invoices, customers, or other pending collections.',
      'Use Backup Now to upload queued records when internet is available.',
      'Use Sync Now to refresh local data from the server.',
      'Open IMEI Conflicts when a serialized offline record could not sync cleanly.',
      'If you are SuperAdmin, you can also use Export Tenant Data or Import Tenant Data from the Tenant Import / Export section.'
    ]
  },
  {
    id: 'labels',
    title: 'How To Print Labels',
    keywords: ['labels', 'barcode label', 'print sticker'],
    answer: [
      'Open Labels, search the product, choose the label quantity and print layout.',
      'Use this for barcode stickers, shelf labels, or packaging labels depending on your setup.'
    ]
  },
  {
    id: 'refund-approvals',
    title: 'How To Use Refund Approvals',
    keywords: ['refund approvals', 'approve refund', 'refund request review'],
    answer: [
      'Open Refund Approvals from the sidebar.',
      'Find the pending refund request and review the receipt or invoice reference, evidence, and requested amount.',
      'If the item should return to stock, choose the restock option and quantities or exact units where needed.',
      'Enter your approval decision and remark, then approve or reject the request.',
      'Approved refunds reduce revenue and can restock inventory according to the decision taken.'
    ]
  },
  {
    id: 'stock-records-page',
    title: 'How To Use Stock Records',
    keywords: ['stock records page', 'trace stock records', 'stock movement history'],
    answer: [
      'Open Admin then Stock Records.',
      'Use Period, From, To, Actor, Branch, and Source to narrow the movements you want to inspect.',
      'Review the rows to see when quantity changed, who triggered it, and which page or source document caused it.',
      'Use Export CSV or Export PDF when you want to share or print the filtered stock history.',
      'If you are SuperAdmin, you can bulk-select rows, choose Delete Selected, and click Apply when records truly need removal.'
    ]
  },
  {
    id: 'config-help',
    title: 'How To Use Config Settings',
    keywords: ['config', 'settings', 'receipt settings', 'communication sounds', 'finance accounts'],
    answer: [
      'Open Admin then Config.',
      'Use the different settings areas to manage branding, receipt details, tax, invoice numbering, refresh behavior, communication sounds, and other system options.',
      'In Communication Sounds, choose Message Sound and Call Sound, then use Test Message Sound or Test Call Sound before saving.',
      'In Finance Accounts, enter the account form and save the company account used for reconciliation deposits.',
      'In Manage Categories, type the category name and click Add.',
      'In the branch area, enter the branch details and click Add to create a retail, wholesale, or warehouse branch.',
      'After changing values, click Save so the rest of the app uses the updated configuration.'
    ]
  },
  {
    id: 'backup-import-export',
    title: 'How To Import Or Export Tenant Data',
    keywords: ['import tenant data', 'export tenant data', 'backup json', 'tenant backup'],
    answer: [
      'Open Backup, then go to the Tenant Import / Export section.',
      'Click Export Tenant Data to download the current tenant collections as a backup JSON file.',
      'Click Import Tenant Data to open the import modal.',
      'Choose the backup file, then select Import Mode as Keep Current Data or Overwrite Current Data.',
      'Review the Import Preview, then click Start Import.'
    ]
  },
  {
    id: 'customer-leaderboard-controls',
    title: 'How To Use Customer Leaderboard',
    keywords: ['customer leaderboard tab', 'amount spent', 'products bought', 'retail customers', 'distribution customers'],
    answer: [
      'Open Partners then Customers, then switch to Customer Leaderboard.',
      'Use the ranking mode selector to choose Amount Spent or Products Bought.',
      'Use the type filter to show All Customers, Retail Customers, or Distribution Customers.',
      'Review the chart for the top entries and the table below for the full ranking list.'
    ]
  },
  {
    id: 'manual-docs-help',
    title: 'How To Find Help Pages',
    keywords: ['manual', 'docs', 'help page', 'system guide'],
    answer: [
      'Open Admin then Manual when you want user-friendly operational guidance.',
      'Open Docs when you need more technical or implementation-oriented reference information.',
      'Use Ask PT AI when you want to ask a workflow question directly in chat style instead of reading the full manual.'
    ]
  },
  {
    id: 'tenants-help',
    title: 'How To Use Tenants',
    keywords: ['tenants', 'tenant management', 'superadmin tenant page'],
    answer: [
      'Open Admin then Tenants if you are logged in as SuperAdmin.',
      'Use the tenant page to create, review, or manage tenant-level information and access.',
      'Tenant features and plan-related controls there affect what the tenant can see in the rest of the app.'
    ]
  },
  {
    id: 'audit-log-help',
    title: 'How To Use Audit Log',
    keywords: ['audit log', 'activity log', 'who changed what'],
    answer: [
      'Open Admin then Audit Log.',
      'Apply filters for date, action, actor, or related source when you need to investigate a change.',
      'Review the rows to see who performed the action and what was affected.',
      'Use exports when you need to share the audit details externally.'
    ]
  },
  {
    id: 'server-logs-help',
    title: 'How To Use Server Logs',
    keywords: ['server logs', 'backend logs', 'debug logs'],
    answer: [
      'Open Admin then Server Logs if you are SuperAdmin.',
      'Use the page to inspect backend events, errors, status codes, and runtime messages.',
      'Refresh or export the logs when you need to troubleshoot a live issue with technical detail.'
    ]
  },
  {
    id: 'cashdrawer-help',
    title: 'How To Use Cash Drawer',
    keywords: ['cash drawer', 'open session', 'cash in', 'cash out', 'close session'],
    answer: [
      'Open Admin then Cash Drawer.',
      'Start by opening a session with the opening float amount.',
      'Use Cash In and Cash Out to record drawer movements during the shift.',
      'Review the expected cash before closing the session at the end of the shift.',
      'Use Open Drawer Now only when you need the physical drawer pulse without recording a sale.'
    ]
  },
  {
    id: 'godhand-help',
    title: 'How To Use GodHand',
    keywords: ['godhand help', 'feature toggles', 'hide menu from sidebar'],
    answer: [
      'Open Admin then GodHand as SuperAdmin.',
      'Turn features, pages, or menu groups on or off based on what the tenant has paid for or should use.',
      'Save the changes so the sidebar and route access follow the new feature state.',
      'Use this carefully because disabled features disappear from users and are blocked by route protection.'
    ]
  },
  {
    id: 'communication',
    title: 'How Communication Works',
    keywords: ['communication', 'chat', 'ask pt ai', 'internal message', 'reply to message', 'chat reaction', 'emoji message', 'message popup', 'message ticks', 'copy chat message', 'long press message', 'chat sound', 'notification sound', 'voice call', 'test sound', 'missed call', 'call history', 'ringing tone', 'call sound'],
    answer: [
      'Open Communication from the sidebar, then choose Chat or Ask PT AI.',
      'Use Chat to send internal messages to other active users inside the same tenant.',
      'Chat supports unread badges, live updates, popup alerts, selectable notification sounds, replies to a specific message, message reactions, emoji, simple one-to-one voice calls, recent call history, and sent or read ticks on your own messages.',
      'Click Reply on a message to quote it, then click the quoted tag later to jump back to the original message when it is visible in the loaded conversation.',
      'To change Communication sounds, go to Config Settings and choose separate Message Sound and Call Sound options such as Off, Soft, Classic, or Bright, then use the test buttons to preview them.',
      'To start a voice call, open Chat, select the user, click Voice Call, and let the other user answer from their chat screen. The caller also hears a progress ringing tone, incoming calls ring for a short time, and unanswered calls can appear as missed calls in recent call history.',
      'Use Ask PT AI when you want step-by-step help for any menu or workflow inside the system.'
    ]
  },
  {
    id: 'finance-accounts',
    title: 'How Finance Accounts And Deposits Work',
    keywords: ['finance account', 'company account', 'deposit split', 'bank account', 'reconciliation account'],
    answer: [
      'Finance accounts are created in Config and can be shared across branches or limited to selected branches.',
      'When reconciling sales, you can allocate the expected amount into one or more company accounts.',
      'The sum of those allocations must exactly match the expected sales amount before approval can complete.'
    ]
  },
  {
    id: 'purchase-tabs',
    title: 'How To Use Purchase Tabs And Approval Buttons',
    keywords: ['purchase tabs', 'initiate purchase', 'purchase approvals', 'director approve purchase', 'manager approve purchase'],
    answer: [
      'Open Retail Purchases and use the Initiate tab to create new purchase requests.',
      'Click Add Purchase, enter the purchase details, then click Submit For Approval.',
      'Switch to the Approvals tab to review pending requests when you have approval rights.',
      'Use Director Approve or Manager Approve based on the current stage, and use Reject when the request should not pass.',
      'Approved and Rejected filters help you review completed decisions later.'
    ]
  },
  {
    id: 'transfer-tabs',
    title: 'How To Use Transfer Tabs And Approval Buttons',
    keywords: ['transfer tabs', 'initiate transfer', 'transfer approvals', 'approve transfer', 'reject transfer'],
    answer: [
      'Open Transfers and use the Initiate tab to create a new transfer request.',
      'Click Add Transfer, fill the source branch, destination branch, items, and required remark, then click Submit For Approval.',
      'Use the Approvals tab to review pending transfer requests.',
      'Approvers use Approve or Reject, and the request detail panel shows the initiation remark and approval or rejection remarks.'
    ]
  },
  {
    id: 'adjustment-tabs',
    title: 'How To Use Adjustment Tabs And Approval Buttons',
    keywords: ['adjustment tabs', 'initiate adjustment', 'adjustment approvals', 'director approve adjustment', 'manager approve adjustment'],
    answer: [
      'Open Adjustments and use the Initiate tab to create a new adjustment request.',
      'Click Add Adjustment, choose the item, set Adjustment Type, enter Reason and Remark (required), then click Submit For Approval.',
      'Use the Approvals tab to review pending requests.',
      'Approvers use Director Approve or Manager Approve based on the current stage, or Reject if the request should fail.'
    ]
  }
];

function normalizeText(value) {
  let text = String(value || '').toLowerCase();
  TYPO_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function toBigrams(value) {
  const normalized = ` ${normalizeText(value)} `;
  const out = [];
  for (let i = 0; i < normalized.length - 1; i += 1) out.push(normalized.slice(i, i + 2));
  return out;
}

function diceCoefficient(a, b) {
  const aPairs = toBigrams(a);
  const bPairs = toBigrams(b);
  if (!aPairs.length || !bPairs.length) return 0;
  const counts = new Map();
  aPairs.forEach((pair) => counts.set(pair, (counts.get(pair) || 0) + 1));
  let overlap = 0;
  bPairs.forEach((pair) => {
    const current = counts.get(pair) || 0;
    if (current > 0) {
      overlap += 1;
      counts.set(pair, current - 1);
    }
  });
  return (2 * overlap) / (aPairs.length + bPairs.length);
}

function scoreTopic(query, topic) {
  const q = normalizeText(query);
  const qTokens = tokenize(query);
  const corpus = [topic.title, ...(topic.keywords || []), ...(topic.answer || [])].join(' ');
  const corpusNormalized = normalizeText(corpus);
  let score = diceCoefficient(q, `${topic.title} ${(topic.keywords || []).join(' ')}`) * 12;
  qTokens.forEach((token) => {
    if (corpusNormalized.includes(token)) score += token.length >= 4 ? 3 : 1.5;
  });
  (topic.keywords || []).forEach((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (q.includes(normalizedKeyword) || normalizedKeyword.includes(q)) score += 8;
  });
  if (q && normalizeText(topic.title).includes(q)) score += 10;
  return score;
}

export function findBestPtAiAnswer(query) {
  const q = normalizeText(query);
  if (!q) return null;
  const ranked = PT_AI_TOPICS
    .map((topic) => ({ topic, score: scoreTopic(q, topic) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 4) {
    return {
      title: 'I need a clearer question',
      answer: [
        'Try using the main feature name in your question.',
        'Examples: serialized item, IMEI phone, transfer stock, cash reconciliation, customer leaderboard, or create user.'
      ],
      related: PT_AI_TOPICS.slice(0, 5)
    };
  }
  return {
    ...best.topic,
    related: ranked.slice(1, 4).map((item) => item.topic)
  };
}
