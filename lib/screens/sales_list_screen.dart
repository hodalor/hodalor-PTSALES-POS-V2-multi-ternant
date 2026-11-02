import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../data/models.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/app_chrome.dart';
import '../widgets/brand_logo.dart';
import '../widgets/common.dart';

class SalesListScreen extends StatefulWidget {
  const SalesListScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SalesListScreen> createState() => _SalesListScreenState();
}

class _SalesListScreenState extends State<SalesListScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return AnimatedBuilder(
      animation: session,
      builder: (context, _) {
        final snap = session.snapshot;
        final q = _query.trim().toLowerCase();
        final rows = snap.sales.where((sale) {
          if (q.isEmpty) return true;
          return sale.receipt.toLowerCase().contains(q) ||
              sale.seller.toLowerCase().contains(q) ||
              sale.branch.toLowerCase().contains(q) ||
              sale.totalLabel.toLowerCase().contains(q);
        }).toList();
        final stamp = DateFormat('d MMM yyyy').format(session.period.from);
        final endStamp = DateFormat('d MMM yyyy').format(session.period.to);

        return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: const BrandLockup(compact: true),
      ),
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('View All Sales', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                SizedBox(height: 4),
                Text(
                  'Complete sales list for the selected period',
                  style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: PeriodChips(
              selected: session.period.label,
              onSelected: (label) => applyPeriod(context, session, label),
              onCustom: () => applyPeriod(context, session, 'Custom'),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: InputDecoration(
                hintText: 'Search receipt, seller or branch',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.muted),
                filled: true,
                fillColor: Colors.white,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '${rows.length} sales · $stamp${session.period.from != session.period.to ? ' – $endStamp' : ''} · ${session.selectedBranch}',
                style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600, fontSize: 12),
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: session.refresh,
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                itemCount: rows.isEmpty ? 1 : rows.length,
                itemBuilder: (context, index) {
                  if (rows.isEmpty) {
                    return const PtCard(child: EmptyHint('No sales in this period for the selected branch'));
                  }
                  return _SaleTile(sale: rows[index]);
                },
              ),
            ),
          ),
        ],
      ),
    );
      },
    );
  }
}

class _SaleTile extends StatelessWidget {
  const _SaleTile({required this.sale});
  final SaleRecord sale;

  @override
  Widget build(BuildContext context) {
    final when = sale.when == null ? '—' : DateFormat('d MMM, HH:mm').format(sale.when!.toLocal());
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: PtCard(
        child: Row(
          children: [
            const SoftIcon(
              icon: Icons.receipt_long_rounded,
              color: AppColors.primary,
              background: AppColors.primarySoft,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    sale.receipt.isEmpty ? sale.id : sale.receipt,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  Text(
                    '${sale.seller} · ${sale.branch}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  Text(
                    '$when · ${sale.items} items',
                    style: const TextStyle(color: AppColors.muted, fontSize: 12),
                  ),
                ],
              ),
            ),
            FittedBox(
              child: Text(sale.totalLabel, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ),
          ],
        ),
      ),
    );
  }
}
