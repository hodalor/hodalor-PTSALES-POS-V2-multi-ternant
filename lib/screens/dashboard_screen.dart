import 'package:flutter/material.dart';

import '../data/models.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/app_chrome.dart';
import '../widgets/charts.dart';
import '../widgets/common.dart';
import 'sales_list_screen.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({
    super.key,
    required this.session,
    required this.onOpenSales,
    required this.onOpenInventory,
  });

  final AppSession session;
  final VoidCallback onOpenSales;
  final VoidCallback onOpenInventory;

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }

  @override
  Widget build(BuildContext context) {
    final snap = session.snapshot;
    final rawRole = session.role.isEmpty ? 'Manager' : session.role;
    final name = rawRole[0].toUpperCase() + rawRole.substring(1);
    return ScrollRefresh(
      onRefresh: session.refresh,
      children: [
        if (session.syncError != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.orangeSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                session.syncError!,
                style: const TextStyle(color: Color(0xFFB45309), fontSize: 11, fontWeight: FontWeight.w700, height: 1.3),
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$_greeting, $name 👋',
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: AppColors.text,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      "Here's your business overview for ${snap.periodLabel.toLowerCase()}",
                      style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
              BranchFilterButton(session: session),
            ],
          ),
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
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(22),
              gradient: const LinearGradient(
                colors: [AppColors.heroStart, AppColors.heroEnd],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Total Sales (${snap.periodLabel})',
                        style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 6),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          snap.heroSales,
                          style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w800),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0x3322C55E),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: DeltaText(snap.heroDelta),
                          ),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Text(
                              snap.comparisonLabel,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w500, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  width: 110,
                  height: 64,
                  child: SparklineChart(values: snap.weekTrend.map((p) => p.value).toList()),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: KpiPairColumn(
            children: [
              for (final kpi in [
                KpiItem(
                  label: 'Profit',
                  value: snap.profit,
                  delta: snap.profitDelta,
                  icon: Icons.monetization_on_rounded,
                  iconColor: AppColors.greenStrong,
                  iconBg: AppColors.greenSoft,
                ),
                KpiItem(
                  label: 'Transactions',
                  value: snap.transactions,
                  icon: Icons.shopping_cart_rounded,
                  iconColor: AppColors.pink,
                  iconBg: AppColors.pinkSoft,
                ),
                KpiItem(
                  label: 'Items Sold',
                  value: snap.itemsSold,
                  icon: Icons.inventory_2_rounded,
                  iconColor: AppColors.primary,
                  iconBg: AppColors.primarySoft,
                ),
                KpiItem(
                  label: 'Active Branches',
                  value: snap.activeBranches,
                  icon: Icons.storefront_rounded,
                  iconColor: AppColors.orange,
                  iconBg: AppColors.orangeSoft,
                ),
              ])
                PtCard(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      SoftIcon(icon: kpi.icon, color: kpi.iconColor, background: kpi.iconBg),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: Text(
                                kpi.value,
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.text),
                              ),
                            ),
                            Text(kpi.label, style: const TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                            if (kpi.delta != null) DeltaText(kpi.delta!),
                          ],
                        ),
                      ),
                    ],
                  ),
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
                      child: Text(
                        'Sales Trend',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                      ),
                    ),
                    GhostSelect(label: snap.trendRangeLabel, onTap: onOpenSales),
                  ],
                ),
                const SizedBox(height: 12),
                SalesBarChart(points: snap.weekTrend),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: PtCard(
                  onTap: onOpenInventory,
                  child: Row(
                    children: [
                      const SoftIcon(
                        icon: Icons.inventory_2_rounded,
                        color: AppColors.purple,
                        background: AppColors.purpleSoft,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Inventory', style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600, fontSize: 12)),
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: Text(snap.stockValue, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                            ),
                            const Text('Stock Value', style: TextStyle(color: AppColors.muted, fontSize: 12)),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: PtCard(
                  onTap: onOpenInventory,
                  child: Row(
                    children: [
                      const SoftIcon(
                        icon: Icons.warning_rounded,
                        color: AppColors.red,
                        background: AppColors.redSoft,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(snap.lowStockCount, style: const TextStyle(color: AppColors.red, fontWeight: FontWeight.w800, fontSize: 20)),
                                const SizedBox(width: 6),
                                const Icon(Icons.chevron_right_rounded, color: AppColors.muted, size: 18),
                              ],
                            ),
                            const Text('Low Stock Items', style: TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
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
                SectionHeader(
                  title: 'Top Selling Products (${snap.periodLabel})',
                  action: 'View All',
                  onAction: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => SalesListScreen(session: session),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 4),
                if (snap.topProducts.isEmpty)
                  const EmptyHint('No products sold in this period')
                else
                  for (final item in snap.topProducts) ProductRow(item: item),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
