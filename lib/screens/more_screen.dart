import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../data/models.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/common.dart';
import 'records_screen.dart';
import 'sales_list_screen.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return ScrollRefresh(
      onRefresh: session.refresh,
      children: [
        const PageIntro(
          title: 'More',
          subtitle: 'Access other business tools and settings',
        ),
        for (final section in MockData.moreSections)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: PtCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    section.title,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                  const SizedBox(height: 12),
                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 4,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 8,
                    childAspectRatio: 0.78,
                    children: [
                      for (final tool in section.tools)
                        _ToolTile(
                          tool: tool.label == 'Approvals'
                              ? MoreTool(
                                  label: tool.label,
                                  icon: tool.icon,
                                  iconColor: tool.iconColor,
                                  iconBg: tool.iconBg,
                                  badge: session.pendingApprovals == 0 ? null : session.pendingApprovals,
                                )
                              : tool,
                          onTap: () => _open(context, tool.label),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  void _open(BuildContext context, String label) {
    Widget page;
    switch (label) {
      case 'Expenses':
        page = RecordsScreen(
          title: 'Expenses',
          subtitle: 'Live expenses for ${session.tenantId}',
          session: session,
          rowsFor: (s) => mapGeneric(s.expenses, s),
        );
        break;
      case 'Stock Transfer':
        page = RecordsScreen(
          title: 'Stock Transfer',
          subtitle: 'Live transfer requests',
          session: session,
          rowsFor: (s) => mapGeneric(s.transfers, s),
        );
        break;
      case 'Approvals':
        page = RecordsScreen(
          title: 'Approvals',
          subtitle: 'Pending and completed approvals',
          session: session,
          rowsFor: (s) => mapGeneric(s.approvals, s),
        );
        break;
      case 'Staff & Users':
        page = RecordsScreen(
          title: 'Staff & Users',
          subtitle: 'Users on this tenant',
          session: session,
          rowsFor: (s) => [
            for (final raw in s.users)
              if (raw is Map)
                RecordRow(
                  title: pick(raw, ['name']),
                  subtitle: pick(raw, ['role']),
                  trailing: (raw['active'] == false) ? 'Inactive' : 'Active',
                  badgeTone: raw['active'] == false ? 'danger' : 'ok',
                ),
          ],
        );
        break;
      case 'Reports':
        page = RecordsScreen(
          title: 'Reports',
          subtitle: 'Live KPIs for the selected period',
          session: session,
          rowsFor: (s) {
            final live = s.snapshot;
            return [
              RecordRow(title: 'Total Sales', trailing: live.heroSales, subtitle: live.comparisonLabel),
              RecordRow(title: 'Profit', trailing: live.profit, subtitle: live.periodLabel),
              RecordRow(title: 'Transactions', trailing: live.transactions),
              RecordRow(title: 'Items Sold', trailing: live.itemsSold),
              RecordRow(title: 'Avg. Sale Value', trailing: live.avgSale),
              RecordRow(title: 'Stock Value', trailing: live.stockValue),
            ];
          },
        );
        break;
      case 'Product Performance':
        page = RecordsScreen(
          title: 'Product Performance',
          subtitle: 'Top sellers for the selected period',
          session: session,
          rowsFor: (s) => [
            for (final item in s.snapshot.topProducts)
              RecordRow(title: item.name, trailing: '${item.units} units', subtitle: s.selectedBranch),
          ],
        );
        break;
      case 'Sales Analytics':
        page = SalesListScreen(session: session);
        break;
      case 'Leaderboard':
        page = RecordsScreen(
          title: 'Leaderboard',
          subtitle: 'Salespeople for the selected period',
          session: session,
          rowsFor: (s) => [
            for (final person in s.snapshot.salespeople)
              RecordRow(title: person.name, trailing: person.label, subtitle: s.selectedBranch),
          ],
        );
        break;
      case 'Stock Adjustment':
        page = RecordsScreen(
          title: 'Stock Adjustment',
          subtitle: 'Live adjustment requests',
          session: session,
          rowsFor: (s) => mapGeneric(s.adjustments, s),
        );
        break;
      case 'Purchase Orders':
        page = RecordsScreen(
          title: 'Purchase Orders',
          subtitle: 'Live purchase requests',
          session: session,
          rowsFor: (s) => mapGeneric(s.purchases, s),
        );
        break;
      case 'Returns & Refunds':
        page = RecordsScreen(
          title: 'Returns & Refunds',
          subtitle: 'Live refund requests',
          session: session,
          rowsFor: (s) => mapGeneric(s.refunds, s),
        );
        break;
      case 'Reconciliation':
        page = RecordsScreen(
          title: 'Reconciliation',
          subtitle: 'Live cash reconciliations',
          session: session,
          rowsFor: (s) => mapGeneric(s.reconciliations, s),
        );
        break;
      case 'Settings':
        page = RecordsScreen(
          title: 'Settings',
          subtitle: 'Tenant ${session.tenantId}',
          session: session,
          rowsFor: (s) {
            final settings = s.settings ?? const <String, dynamic>{};
            return [
              for (final key in ['clientAppName', 'currencySymbol', 'subscriptionPlan', 'themeColor'])
                if ((settings[key] ?? '').toString().trim().isNotEmpty)
                  RecordRow(title: key, trailing: settings[key].toString()),
              RecordRow(title: 'Logged in user', trailing: s.username, subtitle: s.role),
              RecordRow(title: 'Selected branch', trailing: s.selectedBranch),
            ];
          },
        );
        break;
      case 'Role & Permissions':
        page = RecordsScreen(
          title: 'Role & Permissions',
          subtitle: session.role,
          session: session,
          rowsFor: (s) => [
            RecordRow(title: 'Role', trailing: s.role, subtitle: s.username),
            if (s.grants.isEmpty)
              const RecordRow(title: 'No extra grants on this account', subtitle: 'Role permissions apply')
            else
              for (final grant in s.grants) RecordRow(title: grant),
          ],
        );
        break;
      default:
        page = RecordsScreen(
          title: label,
          subtitle: 'Live tenant data',
          session: session,
          rowsFor: (_) => const [],
        );
    }
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
  }
}

class _ToolTile extends StatelessWidget {
  const _ToolTile({required this.tool, required this.onTap});
  final MoreTool tool;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              SoftIcon(
                icon: tool.icon,
                color: tool.iconColor,
                background: tool.iconBg,
                size: 52,
                iconSize: 24,
              ),
              if (tool.badge != null)
                Positioned(
                  right: -4,
                  top: -4,
                  child: Container(
                    width: 18,
                    height: 18,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(color: AppColors.red, shape: BoxShape.circle),
                    child: Text(
                      '${tool.badge}',
                      style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            tool.label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, height: 1.15),
          ),
        ],
      ),
    );
  }
}
