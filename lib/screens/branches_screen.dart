import 'package:flutter/material.dart';

import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/app_chrome.dart';
import '../widgets/charts.dart';
import '../widgets/common.dart';

class BranchesScreen extends StatefulWidget {
  const BranchesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BranchesScreen> createState() => _BranchesScreenState();
}

class _BranchesScreenState extends State<BranchesScreen> {
  String _tab = 'Performance';

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final snap = session.snapshot;
    final rows = _tab == 'Performance' ? snap.branchPerf : snap.branchStock;
    return ScrollRefresh(
      onRefresh: session.refresh,
      children: [
        PageIntro(
          title: 'Branches',
          subtitle: 'Monitor performance across all locations',
          trailing: GhostSelect(
            label: session.period.label,
            onTap: () => applyPeriod(context, session, 'Custom'),
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
          child: Row(
            children: [
              Expanded(
                child: _MiniStat(
                  icon: Icons.storefront_rounded,
                  iconColor: AppColors.greenStrong,
                  iconBg: AppColors.greenSoft,
                  value: snap.activeBranches,
                  label: 'Branches',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MiniStat(
                  icon: Icons.bar_chart_rounded,
                  iconColor: AppColors.primary,
                  iconBg: AppColors.primarySoft,
                  value: snap.monthSales,
                  label: 'Total Sales',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MiniStat(
                  icon: Icons.inventory_2_rounded,
                  iconColor: AppColors.purple,
                  iconBg: AppColors.purpleSoft,
                  value: snap.monthItems,
                  label: 'Items Sold',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MiniStat(
                  icon: Icons.track_changes_rounded,
                  iconColor: AppColors.orange,
                  iconBg: AppColors.orangeSoft,
                  value: snap.targetAchieved,
                  label: 'Target Achieved',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => _tab = 'Performance'),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: _tab == 'Performance' ? AppColors.primary : Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        'Performance',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: _tab == 'Performance' ? Colors.white : AppColors.mutedStrong,
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => _tab = 'Stock'),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: _tab == 'Stock' ? Colors.white : Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        'Stock',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: _tab == 'Stock' ? AppColors.text : AppColors.mutedStrong,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            children: [
              if (rows.isEmpty)
                PtCard(child: EmptyHint(_tab == 'Performance' ? 'No branch sales in this period' : 'No branch stock yet'))
              else
                for (final branch in rows)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: PtCard(
                      child: Column(
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.location_on_rounded, color: AppColors.primary),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  branch.name,
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Flexible(
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    branch.sales,
                                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.primary),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(child: ProgressBar(value: branch.percent / 100, color: branch.color)),
                              const SizedBox(width: 10),
                              Text(
                                '${branch.percent}%',
                                style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.muted),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: PtCard(
            color: const Color(0xFFECFDF5),
            child: Row(
              children: [
                const SoftIcon(
                  icon: Icons.emoji_events_rounded,
                  color: AppColors.gold,
                  background: AppColors.goldSoft,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Top Performing Branch', style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600, fontSize: 12)),
                      Text(snap.topBranchName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    ],
                  ),
                ),
                FittedBox(
                  child: Text(snap.topBranchSales, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return PtCard(
      padding: const EdgeInsets.fromLTRB(8, 12, 8, 12),
      child: Column(
        children: [
          SoftIcon(icon: icon, color: iconColor, background: iconBg, size: 32, iconSize: 18),
          const SizedBox(height: 8),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
            ),
          ),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.muted, fontSize: 10, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
