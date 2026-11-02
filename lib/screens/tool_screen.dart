import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../widgets/brand_logo.dart';
import '../widgets/common.dart';

class ToolScreen extends StatelessWidget {
  const ToolScreen({
    super.key,
    required this.title,
    required this.subtitle,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: const BrandLockup(compact: true),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Text(title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(subtitle, style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500)),
          const SizedBox(height: 16),
          PtCard(
            child: Column(
              children: [
                SoftIcon(
                  icon: Icons.dashboard_customize_rounded,
                  color: AppColors.primary,
                  background: AppColors.primarySoft,
                  size: 52,
                  iconSize: 26,
                ),
                const SizedBox(height: 12),
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
                ),
                const SizedBox(height: 6),
                const Text(
                  'This workspace matches the ptSales menu and will load live tenant data after login is connected to the API.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.muted, height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
