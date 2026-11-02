import 'package:flutter/material.dart';

import '../data/models.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import 'brand_logo.dart';
import 'common.dart';

Future<void> applyPeriod(BuildContext context, AppSession session, String label) async {
  if (label == 'Custom') {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 3),
      lastDate: now,
      initialDateRange: DateTimeRange(start: session.period.from, end: session.period.to),
    );
    if (picked != null) {
      session.setPeriod(PeriodFilter.custom(picked.start, picked.end));
    }
    return;
  }
  if (label == 'This Week') {
    session.setPeriod(PeriodFilter.week());
  } else if (label == 'This Month') {
    session.setPeriod(PeriodFilter.month());
  } else {
    session.setPeriod(PeriodFilter.today());
  }
}

class AppHeader extends StatelessWidget {
  const AppHeader({
    super.key,
    required this.session,
    this.onMenu,
    this.showMenu = true,
  });

  final AppSession session;
  final VoidCallback? onMenu;
  final bool showMenu;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.card,
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
      child: Row(
        children: [
          IconButton(
            onPressed: onMenu,
            icon: Icon(
              showMenu ? Icons.menu_rounded : Icons.arrow_back_ios_new_rounded,
              color: AppColors.text,
            ),
          ),
          const BrandLockup(compact: true),
          const Spacer(),
          Stack(
            clipBehavior: Clip.none,
            children: [
              IconButton(
                onPressed: () {
                  final count = session.unreadNotifications;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        count == 0
                            ? 'No pending approvals'
                            : 'You have $count pending approval${count == 1 ? '' : 's'}',
                      ),
                    ),
                  );
                },
                icon: const Icon(Icons.notifications_none_rounded, color: AppColors.text),
              ),
              if (session.unreadNotifications > 0)
                Positioned(
                  right: 10,
                  top: 10,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: AppColors.red,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                  ),
                ),
            ],
          ),
          const CircleAvatar(
            radius: 16,
            backgroundColor: Color(0xFFE2E8F0),
            child: Icon(Icons.person_rounded, color: AppColors.mutedStrong, size: 18),
          ),
          const SizedBox(width: 8),
        ],
      ),
    );
  }
}

class BranchFilterButton extends StatelessWidget {
  const BranchFilterButton({super.key, required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return GhostSelect(
      label: session.selectedBranch,
      onTap: () => _open(context),
    );
  }

  Future<void> _open(BuildContext context) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        final maxHeight = MediaQuery.of(context).size.height * 0.7;
        final names = session.snapshot.branchNames;
        return SafeArea(
          child: SizedBox(
            height: maxHeight,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Select branch',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: names.length,
                    itemBuilder: (context, index) {
                      final branch = names[index];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          branch,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: branch == session.selectedBranch ? AppColors.primary : AppColors.text,
                          ),
                        ),
                        trailing: branch == session.selectedBranch
                            ? const Icon(Icons.check_rounded, color: AppColors.primary)
                            : null,
                        onTap: () => Navigator.pop(context, branch),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (selected != null) session.setBranch(selected);
  }
}

class PtBottomNav extends StatelessWidget {
  const PtBottomNav({
    super.key,
    required this.index,
    required this.onChanged,
  });

  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    const items = [
      _NavSpec(Icons.home_rounded, 'Dashboard'),
      _NavSpec(Icons.bar_chart_rounded, 'Sales'),
      _NavSpec(Icons.inventory_2_rounded, 'Inventory'),
      _NavSpec(Icons.storefront_rounded, 'Branches'),
      _NavSpec(Icons.apps_rounded, 'More'),
    ];
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Color(0x140F172A), blurRadius: 18, offset: Offset(0, -4))],
      ),
      padding: EdgeInsets.only(
        left: 8,
        right: 8,
        top: 8,
        bottom: 8 + MediaQuery.of(context).padding.bottom,
      ),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(i),
                child: Semantics(
                  button: true,
                  label: items[i].label,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: i == index ? AppColors.primarySurface : Colors.transparent,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          items[i].icon,
                          color: i == index ? AppColors.primary : AppColors.navInactive,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          items[i].label,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: i == index ? AppColors.primary : AppColors.navInactive,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _NavSpec {
  const _NavSpec(this.icon, this.label);
  final IconData icon;
  final String label;
}

class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key, required this.session, required this.onLogout});

  final AppSession session;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: Colors.white,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const BrandLockup(),
              const SizedBox(height: 24),
              Text(
                session.username.isEmpty ? 'Manager' : session.username,
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
              ),
              Text(
                session.role,
                style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600),
              ),
              Text(
                'Tenant: ${session.tenantId}',
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              const Spacer(),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.logout_rounded, color: AppColors.red),
                title: const Text('Log out', style: TextStyle(fontWeight: FontWeight.w700)),
                onTap: onLogout,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
