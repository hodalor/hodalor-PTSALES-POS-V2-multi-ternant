import 'package:flutter/material.dart';

import '../data/snapshot.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/app_chrome.dart';
import '../widgets/charts.dart';
import '../widgets/common.dart';
import 'sales_list_screen.dart';

class SalesScreen extends StatelessWidget {
  const SalesScreen({super.key, required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    final snap = session.snapshot;
    return ScrollRefresh(
      onRefresh: session.refresh,
      children: [
          PageIntro(
            title: 'Sales',
            subtitle: 'Monitor sales performance and trends',
            trailing: BranchFilterButton(session: session),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: PeriodChips(
              selected: session.period.label,
              onSelected: (label) => applyPeriod(context, session, label),
              onCustom: () => applyPeriod(context, session, 'Custom'),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: KpiPairColumn(
              children: [
                _SalesKpi(
                  icon: Icons.shopping_cart_rounded,
                  iconColor: AppColors.primary,
                  iconBg: AppColors.primarySoft,
                  label: 'Total Sales',
                  value: snap.heroSales,
                  delta: snap.heroDelta,
                ),
                _SalesKpi(
                  icon: Icons.receipt_long_rounded,
                  iconColor: AppColors.orange,
                  iconBg: AppColors.orangeSoft,
                  label: 'Transactions',
                  value: snap.transactions,
                  delta: snap.txDelta,
                ),
                _SalesKpi(
                  icon: Icons.inventory_2_rounded,
                  iconColor: AppColors.primary,
                  iconBg: AppColors.primarySoft,
                  label: 'Items Sold',
                  value: snap.itemsSold,
                  delta: snap.itemsDelta,
                ),
                _SalesKpi(
                  icon: Icons.groups_rounded,
                  iconColor: AppColors.purple,
                  iconBg: AppColors.purpleSoft,
                  label: 'Avg. Sale Value',
                  value: snap.avgSale,
                  delta: snap.avgDelta,
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: PtCard(
              child: Column(
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text('Sales Trend', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      ),
                      GhostSelect(
                        label: snap.trendRangeLabel,
                        onTap: () => applyPeriod(context, session, 'Custom'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SalesLineChart(points: snap.salesLine, highlightLabel: snap.heroSales),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          _Breakdown(session: session),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: PtCard(
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => SalesListScreen(session: session),
                  ),
                );
              },
              child: const Row(
                children: [
                  SoftIcon(
                    icon: Icons.description_rounded,
                    color: AppColors.primary,
                    background: AppColors.primarySoft,
                  ),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'View All Sales',
                      style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                    ),
                  ),
                  Icon(Icons.chevron_right_rounded, color: AppColors.muted),
                ],
              ),
            ),
          ),
        ],
    );
  }
}

class _Breakdown extends StatefulWidget {
  const _Breakdown({required this.session});
  final AppSession session;

  @override
  State<_Breakdown> createState() => _BreakdownState();
}

class _BreakdownState extends State<_Breakdown> {
  String _breakdown = 'Top Selling Products';

  @override
  Widget build(BuildContext context) {
    final snap = widget.session.snapshot;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final tab in ['Top Selling Products', 'By Category', 'By Branch', 'By Salesperson']) ...[
                  PillChip(
                    label: tab,
                    selected: _breakdown == tab,
                    onTap: () => setState(() => _breakdown = tab),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: PtCard(child: _body(snap)),
        ),
      ],
    );
  }

  Widget _body(AppSnapshot snap) {
    if (_breakdown == 'By Category') {
      if (snap.categories.isEmpty) return const EmptyHint('No category sales in this period');
      return Column(
        children: [
          for (final cat in snap.categories)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Container(width: 10, height: 10, decoration: BoxDecoration(color: cat.color, shape: BoxShape.circle)),
                  const SizedBox(width: 10),
                  Expanded(child: Text(cat.label, style: const TextStyle(fontWeight: FontWeight.w700))),
                  Text('${cat.percent}%', style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
        ],
      );
    }
    if (_breakdown == 'By Branch') {
      if (snap.branchPerf.isEmpty) return const EmptyHint('No branch sales in this period');
      return Column(
        children: [
          for (final branch in snap.branchPerf)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Expanded(child: Text(branch.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                  Text(branch.sales, style: const TextStyle(fontWeight: FontWeight.w800)),
                ],
              ),
            ),
        ],
      );
    }
    if (_breakdown == 'By Salesperson') {
      if (snap.salespeople.isEmpty) return const EmptyHint('No salesperson sales in this period');
      return Column(
        children: [
          for (final person in snap.salespeople)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Expanded(child: Text(person.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                  Text(person.label, style: const TextStyle(fontWeight: FontWeight.w800)),
                ],
              ),
            ),
        ],
      );
    }
    if (snap.topProducts.isEmpty) return const EmptyHint('No products sold in this period');
    return Column(
      children: [
        for (final item in snap.topProducts) ProductRow(item: item),
      ],
    );
  }
}

class _SalesKpi extends StatelessWidget {
  const _SalesKpi({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.label,
    required this.value,
    required this.delta,
  });

  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String label;
  final String value;
  final String delta;

  @override
  Widget build(BuildContext context) {
    return PtCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          SoftIcon(icon: icon, color: iconColor, background: iconBg, size: 32, iconSize: 17),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600)),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, height: 1.15)),
          ),
          DeltaText(delta),
        ],
      ),
    );
  }
}
