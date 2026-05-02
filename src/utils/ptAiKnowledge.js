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
    title: 'How Purchases Add Stock',
    keywords: ['purchase', 'add stock', 'receive stock', 'goods received'],
    answer: [
      'Create the purchase request from the correct branch type: retail, distribution, or warehouse.',
      'If the product is serialized, enter or scan the unit identifiers during receiving.',
      'Submit for approval when your workflow requires it.',
      'When approved, stock is applied to the correct inventory bucket for that branch type.'
    ]
  },
  {
    id: 'transfer-stock',
    title: 'How Transfers Work Between Inventory Types',
    keywords: ['transfer', 'move stock', 'retail to warehouse', 'warehouse to distribution', 'cross inventory transfer'],
    answer: [
      'Create the transfer from the source branch that currently holds the stock.',
      'Choose the destination branch even if it belongs to another inventory type.',
      'For serialized products, pick the exact units to move.',
      'After approval, stock is deducted from the source inventory map and credited to the destination inventory map.'
    ]
  },
  {
    id: 'adjustments',
    title: 'How To Make An Adjustment',
    keywords: ['adjustment', 'increase stock', 'decrease stock', 'damage remove', 'stock correction'],
    answer: [
      'Open the correct adjustment page for retail, distribution, or warehouse.',
      'Choose the product, branch, quantity, and adjustment type.',
      'Enter the reason and the required remark before submitting.',
      'For serialized products, adjust by selecting the actual unit records instead of typing a manual quantity.',
      'Approvals then apply the signed stock movement for the correct inventory type.'
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
    id: 'cash-reconciliation',
    title: 'How Cash Reconciliation Works',
    keywords: ['cash reconciliation', 'finance', 'deposit', 'bank', 'backlog', 'proof of deposit'],
    answer: [
      'Open Finance then Cash Reconciliation.',
      'Select the branch backlog dates that have sales but are not yet deposited.',
      'The system calculates the expected total automatically from those sales dates.',
      'Split the deposit into one or more allocations if needed, attach proof, and make sure entered total exactly matches expected total.',
      'Manager and director approval remarks are required before balances update.'
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
      'Open Users and create the user with role, PIN, and assigned branches.',
      'Use feature access and grants to decide which menus and actions they can use.',
      'Tenant features and GodHand decide whether a module exists at all, while grants decide what the user may do inside it.'
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
      'Open Reports and choose the report type plus the branch and date filters you need.',
      'Use the export buttons for CSV or PDF where available.',
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
      'Name, phone, and address are the key fast-entry fields when customer details are needed for sale completion.'
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
    title: 'How Invoice And Receipt Details Work',
    keywords: ['invoice', 'receipt', 'business name', 'tpin', 'address', 'total price'],
    answer: [
      'Invoices and receipts can show customer business name, TPIN or TIN, and address when those fields exist on the customer record.',
      'If a field is empty, the document hides that field instead of showing blank labels.',
      'Totals are calculated from the selected selling price and quantity for the chosen inventory flow.'
    ]
  },
  {
    id: 'backup-sync',
    title: 'How Backup And Sync Work',
    keywords: ['backup', 'sync', 'offline', 'queue', 'imei conflicts'],
    answer: [
      'When offline, supported actions are queued locally.',
      'Backup and Sync uploads them later when internet returns.',
      'Serialized conflicts are shown in IMEI Conflicts for review if a queued serialized sale cannot be applied cleanly.'
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
    id: 'communication',
    title: 'How Communication Works',
    keywords: ['communication', 'chat', 'ask pt ai', 'internal message'],
    answer: [
      'Use Chat to send internal messages to other active users inside the same tenant.',
      'Use Ask PT AI when you want help understanding a feature or workflow inside the system.',
      'Ask PT AI supports typing, voice input, and voice playback of the answer.'
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
