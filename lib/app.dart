import 'package:flutter/material.dart';

import 'screens/login_screen.dart';
import 'screens/main_shell.dart';
import 'state/app_session.dart';
import 'theme/app_theme.dart';

class PtSalesApp extends StatefulWidget {
  const PtSalesApp({super.key});

  @override
  State<PtSalesApp> createState() => _PtSalesAppState();
}

class _PtSalesAppState extends State<PtSalesApp> {
  final AppSession _session = AppSession();

  @override
  void initState() {
    super.initState();
    _session.restore();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _session,
      builder: (context, _) {
        return MaterialApp(
          title: 'ptSales POS SYSTEM',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          builder: (context, child) {
            final width = MediaQuery.sizeOf(context).width;
            final content = child ?? const SizedBox.shrink();
            if (width <= 500) return content;
            return ColoredBox(
              color: const Color(0xFFE8EEF5),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 430),
                  child: content,
                ),
              ),
            );
          },
          home: _session.isLoggedIn
              ? MainShell(
                  session: _session,
                  onLogout: () async {
                    await _session.logout();
                  },
                )
              : LoginScreen(
                  session: _session,
                  onLoggedIn: () {},
                ),
        );
      },
    );
  }
}
