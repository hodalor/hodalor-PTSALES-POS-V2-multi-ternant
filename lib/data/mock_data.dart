import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import 'models.dart';

class MockData {
  static const currency = '₵';

  static const branches = [
    'All Branches',
    'Accra (Head Office)',
    'Kumasi',
    'Takoradi',
    'Koforidua',
  ];

  static const dashboardHeroSales = '₵32,820';
  static const dashboardHeroDelta = '+12.5%';
  static const dashboardHeroHint = 'vs yesterday';

  static const sparkline = [18.0, 22.0, 19.0, 26.0, 24.0, 30.0, 28.0, 36.0, 34.0, 42.0, 48.0, 56.0];

  static const dashboardKpis = [
    KpiItem(
      label: 'Profit',
      value: '₵8,450',
      delta: '+8.2%',
      icon: Icons.monetization_on_rounded,
      iconColor: AppColors.greenStrong,
      iconBg: AppColors.greenSoft,
    ),
    KpiItem(
      label: 'Transactions',
      value: '86',
      icon: Icons.shopping_cart_rounded,
      iconColor: AppColors.pink,
      iconBg: AppColors.pinkSoft,
    ),
    KpiItem(
      label: 'Items Sold',
      value: '143',
      icon: Icons.inventory_2_rounded,
      iconColor: AppColors.primary,
      iconBg: AppColors.primarySoft,
    ),
    KpiItem(
      label: 'Active Branches',
      value: '4',
      icon: Icons.storefront_rounded,
      iconColor: AppColors.orange,
      iconBg: AppColors.orangeSoft,
    ),
  ];

  static const weekTrend = [
    TrendPoint('Mon', 18),
    TrendPoint('Tue', 12),
    TrendPoint('Wed', 22),
    TrendPoint('Thu', 28),
    TrendPoint('Fri', 34),
    TrendPoint('Sat', 42),
    TrendPoint('Today', 56),
  ];

  static const salesLine = [
    TrendPoint('Mon', 8),
    TrendPoint('Tue', 14),
    TrendPoint('Wed', 16),
    TrendPoint('Thu', 18),
    TrendPoint('Fri', 24),
    TrendPoint('Sat', 28),
    TrendPoint('Today', 32.8),
  ];

  static const topProducts = [
    ProductSale(
      name: 'TECNO Charger Kit',
      units: 28,
      share: 1,
      icon: Icons.phone_iphone_rounded,
      accent: AppColors.green,
    ),
    ProductSale(
      name: 'Data Cable (USB-C)',
      units: 20,
      share: 0.72,
      icon: Icons.headphones_rounded,
      accent: AppColors.green,
    ),
    ProductSale(
      name: 'Power Bank PDC2',
      units: 15,
      share: 0.54,
      icon: Icons.battery_charging_full_rounded,
      accent: AppColors.green,
    ),
  ];

  static const lowStock = [
    LowStockItem(
      name: 'Samsung A37',
      units: 0,
      status: 'Out of Stock',
      icon: Icons.smartphone_rounded,
    ),
    LowStockItem(
      name: 'Power Bank PDC2',
      units: 2,
      status: 'Critical',
      icon: Icons.battery_charging_full_rounded,
    ),
    LowStockItem(
      name: 'TECNO Charger Kit',
      units: 5,
      status: 'Low Stock',
      icon: Icons.phone_iphone_rounded,
    ),
  ];

  static const categories = [
    CategoryShare(label: 'Phones', percent: 45, color: AppColors.primary),
    CategoryShare(label: 'Accessories', percent: 35, color: AppColors.green),
    CategoryShare(label: 'Electronics', percent: 12, color: AppColors.amber),
    CategoryShare(label: 'Others', percent: 8, color: AppColors.purple),
  ];

  static const branchPerf = [
    BranchPerf(name: 'Accra (Head Office)', sales: '₵52,450', percent: 87, color: AppColors.green),
    BranchPerf(name: 'Kumasi', sales: '₵28,320', percent: 71, color: AppColors.primary),
    BranchPerf(name: 'Takoradi', sales: '₵24,810', percent: 62, color: AppColors.orange),
    BranchPerf(name: 'Koforidua', sales: '₵22,870', percent: 57, color: AppColors.red),
  ];

  static const moreSections = [
    MoreSection(
      title: 'Business Management',
      tools: [
        MoreTool(
          label: 'Expenses',
          icon: Icons.monetization_on_rounded,
          iconColor: AppColors.greenStrong,
          iconBg: AppColors.greenSoft,
        ),
        MoreTool(
          label: 'Stock Transfer',
          icon: Icons.swap_horiz_rounded,
          iconColor: AppColors.purple,
          iconBg: AppColors.purpleSoft,
        ),
        MoreTool(
          label: 'Approvals',
          icon: Icons.fact_check_rounded,
          iconColor: AppColors.orange,
          iconBg: AppColors.orangeSoft,
          badge: null,
        ),
        MoreTool(
          label: 'Staff & Users',
          icon: Icons.groups_rounded,
          iconColor: AppColors.primary,
          iconBg: AppColors.primarySoft,
        ),
      ],
    ),
    MoreSection(
      title: 'Reports & Insights',
      tools: [
        MoreTool(
          label: 'Reports',
          icon: Icons.bar_chart_rounded,
          iconColor: AppColors.primary,
          iconBg: AppColors.primarySoft,
        ),
        MoreTool(
          label: 'Product Performance',
          icon: Icons.pie_chart_rounded,
          iconColor: AppColors.purple,
          iconBg: AppColors.purpleSoft,
        ),
        MoreTool(
          label: 'Sales Analytics',
          icon: Icons.trending_up_rounded,
          iconColor: AppColors.greenStrong,
          iconBg: AppColors.greenSoft,
        ),
        MoreTool(
          label: 'Leaderboard',
          icon: Icons.emoji_events_rounded,
          iconColor: AppColors.gold,
          iconBg: AppColors.goldSoft,
        ),
      ],
    ),
    MoreSection(
      title: 'Operations',
      tools: [
        MoreTool(
          label: 'Stock Adjustment',
          icon: Icons.view_in_ar_rounded,
          iconColor: AppColors.primary,
          iconBg: AppColors.primarySoft,
        ),
        MoreTool(
          label: 'Purchase Orders',
          icon: Icons.description_rounded,
          iconColor: AppColors.pink,
          iconBg: AppColors.pinkSoft,
        ),
        MoreTool(
          label: 'Returns & Refunds',
          icon: Icons.assignment_return_rounded,
          iconColor: AppColors.greenStrong,
          iconBg: AppColors.greenSoft,
        ),
        MoreTool(
          label: 'Reconciliation',
          icon: Icons.bookmark_rounded,
          iconColor: AppColors.purple,
          iconBg: AppColors.purpleSoft,
        ),
      ],
    ),
    MoreSection(
      title: 'System',
      tools: [
        MoreTool(
          label: 'Settings',
          icon: Icons.settings_rounded,
          iconColor: AppColors.mutedStrong,
          iconBg: Color(0xFFF1F5F9),
        ),
        MoreTool(
          label: 'Role & Permissions',
          icon: Icons.verified_user_rounded,
          iconColor: AppColors.primary,
          iconBg: AppColors.primarySoft,
        ),
      ],
    ),
  ];
}
