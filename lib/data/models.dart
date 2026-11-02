import 'package:flutter/material.dart';

class KpiItem {
  const KpiItem({
    required this.label,
    required this.value,
    this.delta,
    this.subtitle,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
  });

  final String label;
  final String value;
  final String? delta;
  final String? subtitle;
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
}

class ProductSale {
  const ProductSale({
    required this.name,
    required this.units,
    required this.share,
    required this.icon,
    required this.accent,
  });

  final String name;
  final int units;
  final double share;
  final IconData icon;
  final Color accent;
}

class LowStockItem {
  const LowStockItem({
    required this.name,
    required this.units,
    required this.status,
    required this.icon,
  });

  final String name;
  final int units;
  final String status;
  final IconData icon;

  bool get isOut => status == 'Out of Stock';
  bool get isCritical => status == 'Critical';
}

class BranchPerf {
  const BranchPerf({
    required this.name,
    required this.sales,
    required this.percent,
    required this.color,
  });

  final String name;
  final String sales;
  final int percent;
  final Color color;
}

class CategoryShare {
  const CategoryShare({
    required this.label,
    required this.percent,
    required this.color,
  });

  final String label;
  final int percent;
  final Color color;
}

class MoreTool {
  const MoreTool({
    required this.label,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    this.badge,
  });

  final String label;
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final int? badge;
}

class MoreSection {
  const MoreSection({required this.title, required this.tools});

  final String title;
  final List<MoreTool> tools;
}

class TrendPoint {
  const TrendPoint(this.label, this.value);
  final String label;
  final double value;
}

class SaleRecord {
  const SaleRecord({
    required this.id,
    required this.when,
    required this.branch,
    required this.seller,
    required this.totalLabel,
    required this.totalValue,
    required this.items,
    required this.receipt,
  });

  final String id;
  final DateTime? when;
  final String branch;
  final String seller;
  final String totalLabel;
  final double totalValue;
  final int items;
  final String receipt;
}

class NamedAmount {
  const NamedAmount({required this.name, required this.value, required this.label});
  final String name;
  final double value;
  final String label;
}

class PeriodFilter {
  const PeriodFilter({required this.label, required this.from, required this.to});

  final String label;
  final DateTime from;
  final DateTime to;

  static PeriodFilter today() {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    return PeriodFilter(label: 'Today', from: start, to: start);
  }

  static PeriodFilter week() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final start = today.subtract(Duration(days: today.weekday - 1));
    return PeriodFilter(label: 'This Week', from: start, to: today);
  }

  static PeriodFilter month() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return PeriodFilter(label: 'This Month', from: DateTime(now.year, now.month, 1), to: today);
  }

  static PeriodFilter custom(DateTime from, DateTime to) {
    final start = DateTime(from.year, from.month, from.day);
    final end = DateTime(to.year, to.month, to.day);
    return PeriodFilter(label: 'Custom', from: start, to: end.isBefore(start) ? start : end);
  }

  PeriodFilter get previous {
    final days = to.difference(from).inDays + 1;
    final prevTo = from.subtract(const Duration(days: 1));
    final prevFrom = prevTo.subtract(Duration(days: days - 1));
    return PeriodFilter(label: 'prior', from: prevFrom, to: prevTo);
  }

  String get vsLabel {
    switch (label) {
      case 'Today':
        return 'vs yesterday';
      case 'This Week':
        return 'vs last week';
      case 'This Month':
        return 'vs last month';
      default:
        return 'vs prior period';
    }
  }
}
