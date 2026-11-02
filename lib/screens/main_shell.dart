import 'package:flutter/material.dart';

import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/app_chrome.dart';
import 'branches_screen.dart';
import 'dashboard_screen.dart';
import 'inventory_screen.dart';
import 'more_screen.dart';
import 'sales_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key, required this.session, required this.onLogout});

  final AppSession session;
  final VoidCallback onLogout;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;
  final _scaffoldKey = GlobalKey<ScaffoldState>();

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardScreen(
        session: widget.session,
        onOpenSales: () => setState(() => _index = 1),
        onOpenInventory: () => setState(() => _index = 2),
      ),
      SalesScreen(session: widget.session),
      InventoryScreen(session: widget.session),
      BranchesScreen(session: widget.session),
      MoreScreen(session: widget.session),
    ];

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: AppColors.background,
      drawer: AppDrawer(session: widget.session, onLogout: widget.onLogout),
      body: Column(
        children: [
          SafeArea(
            bottom: false,
            child: AppHeader(
              session: widget.session,
              onMenu: () => _scaffoldKey.currentState?.openDrawer(),
            ),
          ),
          Expanded(
            child: IndexedStack(index: _index, children: pages),
          ),
        ],
      ),
      bottomNavigationBar: PtBottomNav(
        index: _index,
        onChanged: (value) => setState(() => _index = value),
      ),
    );
  }
}
