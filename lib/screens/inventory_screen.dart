import 'package:flutter/material.dart';

import '../data/models.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/app_chrome.dart';
import '../widgets/charts.dart';
import '../widgets/common.dart';
import 'records_screen.dart';

class InventoryScreen extends StatelessWidget {
  const InventoryScreen({super.key, required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    final snap = session.snapshot;
    return ScrollRefresh(
      onRefresh: session.refresh,
      children: [
        PageIntro(
          title: 'Inventory',
          subtitle: 'Track stock levels, value and alerts',
          trailing: BranchFilterButton(session: session),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: KpiPairColumn(
            children: [
              _InvKpi(
                icon: Icons.inventory_2_rounded,
                iconColor: AppColors.primary,
                iconBg: AppColors.primarySoft,
                color: Colors.white,
                label: 'Total Stock',
                value: snap.totalStock,
                hint: 'Units',
              ),
              _InvKpi(
                icon: Icons.monetization_on_rounded,
                iconColor: AppColors.greenStrong,
                iconBg: AppColors.greenSoft,
                color: const Color(0xFFECFDF5),
                label: 'Stock Value',
                value: snap.stockValue,
                hint: '',
              ),
              _InvKpi(
                icon: Icons.warning_rounded,
                iconColor: AppColors.red,
                iconBg: AppColors.redSoft,
                color: const Color(0xFFFEF2F2),
                label: 'Low Stock',
                value: snap.lowStockCount,
                hint: 'Items',
                valueColor: AppColors.red,
              ),
              _InvKpi(
                icon: Icons.inventory_2_outlined,
                iconColor: AppColors.purple,
                iconBg: AppColors.purpleSoft,
                color: const Color(0xFFF5F3FF),
                label: 'Out of Stock',
                value: snap.outOfStockCount,
                hint: 'Items',
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
                  title: 'Stock Levels by Category',
                  action: 'View All',
                  onAction: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => RecordsScreen(
                          title: 'Stock by Category',
                          subtitle: 'Live category mix',
                          session: session,
                          rowsFor: (s) => [
                            for (final cat in s.snapshot.categories)
                              RecordRow(title: cat.label, trailing: '${cat.percent}%', subtitle: s.selectedBranch),
                          ],
                        ),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 12),
                if (snap.categories.isEmpty)
                  const EmptyHint('No stock categories for this branch')
                else
                  Row(
                    children: [
                      DonutChart(
                        slices: snap.categories,
                        centerValue: snap.totalStock,
                        centerLabel: 'Units',
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          children: [
                            for (final cat in snap.categories)
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 6),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 10,
                                      height: 10,
                                      decoration: BoxDecoration(color: cat.color, shape: BoxShape.circle),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        cat.label,
                                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                      ),
                                    ),
                                    Text(
                                      '${cat.percent}%',
                                      style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w700),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: PtCard(
            child: Column(
              children: [
                SectionHeader(
                  title: 'Low Stock Items',
                  action: 'View All',
                  onAction: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => RecordsScreen(
                          title: 'Low Stock Items',
                          subtitle: 'Live alerts',
                          session: session,
                          rowsFor: (s) => [
                            for (final item in s.snapshot.lowStock)
                              RecordRow(
                                title: item.name,
                                subtitle: '${item.units} units',
                                trailing: item.status,
                                badgeTone: item.isOut ? 'danger' : 'warn',
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 4),
                if (snap.lowStock.isEmpty)
                  const EmptyHint('No low-stock alerts for this branch')
                else
                  for (final item in snap.lowStock.take(8)) _LowStockRow(item: item),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _InvKpi extends StatelessWidget {
  const _InvKpi({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.color,
    required this.label,
    required this.value,
    required this.hint,
    this.valueColor = AppColors.text,
  });

  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final Color color;
  final String label;
  final String value;
  final String hint;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return PtCard(
      color: color,
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          SoftIcon(icon: icon, color: iconColor, background: iconBg),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: valueColor)),
                ),
                if (hint.isNotEmpty)
                  Text(hint, style: const TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LowStockRow extends StatelessWidget {
  const _LowStockRow({required this.item});
  final LowStockItem item;

  @override
  Widget build(BuildContext context) {
    final tone = item.isOut ? 'danger' : 'warn';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          SoftIcon(
            icon: item.icon,
            color: AppColors.text,
            background: const Color(0xFFF1F5F9),
            size: 44,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                Text(
                  '${item.units} units',
                  style: TextStyle(
                    color: item.isOut ? AppColors.red : AppColors.muted,
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          StatusBadge(label: item.status, tone: tone),
        ],
      ),
    );
  }
}
