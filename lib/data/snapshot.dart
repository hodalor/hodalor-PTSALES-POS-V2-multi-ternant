import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../theme/app_colors.dart';
import 'models.dart';

class AppSnapshot {
  const AppSnapshot({
    required this.currencySymbol,
    required this.heroSales,
    required this.heroDelta,
    required this.profit,
    required this.profitDelta,
    required this.transactions,
    required this.txDelta,
    required this.itemsSold,
    required this.itemsDelta,
    required this.activeBranches,
    required this.avgSale,
    required this.avgDelta,
    required this.stockValue,
    required this.totalStock,
    required this.lowStockCount,
    required this.outOfStockCount,
    required this.weekTrend,
    required this.salesLine,
    required this.topProducts,
    required this.lowStock,
    required this.categories,
    required this.branchPerf,
    required this.branchStock,
    required this.branchNames,
    required this.monthSales,
    required this.monthItems,
    required this.targetAchieved,
    required this.topBranchName,
    required this.topBranchSales,
    required this.live,
    required this.periodLabel,
    required this.comparisonLabel,
    required this.trendRangeLabel,
    required this.sales,
    required this.salespeople,
    this.lastSynced,
  });

  final String currencySymbol;
  final String heroSales;
  final String heroDelta;
  final String profit;
  final String profitDelta;
  final String transactions;
  final String txDelta;
  final String itemsSold;
  final String itemsDelta;
  final String activeBranches;
  final String avgSale;
  final String avgDelta;
  final String stockValue;
  final String totalStock;
  final String lowStockCount;
  final String outOfStockCount;
  final List<TrendPoint> weekTrend;
  final List<TrendPoint> salesLine;
  final List<ProductSale> topProducts;
  final List<LowStockItem> lowStock;
  final List<CategoryShare> categories;
  final List<BranchPerf> branchPerf;
  final List<BranchPerf> branchStock;
  final List<String> branchNames;
  final String monthSales;
  final String monthItems;
  final String targetAchieved;
  final String topBranchName;
  final String topBranchSales;
  final bool live;
  final String periodLabel;
  final String comparisonLabel;
  final String trendRangeLabel;
  final List<SaleRecord> sales;
  final List<NamedAmount> salespeople;
  final DateTime? lastSynced;

  factory AppSnapshot.empty({String symbol = '₵', PeriodFilter? period}) {
    final p = period ?? PeriodFilter.today();
    return AppSnapshot(
      currencySymbol: symbol,
      heroSales: formatMoney(0, symbol),
      heroDelta: '+0.0%',
      profit: formatMoney(0, symbol),
      profitDelta: '+0.0%',
      transactions: '0',
      txDelta: '+0.0%',
      itemsSold: '0',
      itemsDelta: '+0.0%',
      activeBranches: '0',
      avgSale: formatMoney(0, symbol),
      avgDelta: '+0.0%',
      stockValue: formatMoney(0, symbol),
      totalStock: '0',
      lowStockCount: '0',
      outOfStockCount: '0',
      weekTrend: const [],
      salesLine: const [],
      topProducts: const [],
      lowStock: const [],
      categories: const [],
      branchPerf: const [],
      branchStock: const [],
      branchNames: const ['All Branches'],
      monthSales: formatMoney(0, symbol),
      monthItems: '0',
      targetAchieved: '0%',
      topBranchName: '—',
      topBranchSales: formatMoney(0, symbol),
      live: true,
      periodLabel: p.label,
      comparisonLabel: p.vsLabel,
      trendRangeLabel: p.label,
      sales: const [],
      salespeople: const [],
    );
  }
}

String formatMoney(num amount, [String symbol = '₵']) {
  final formatted = NumberFormat('#,##0').format(amount.round());
  return '$symbol$formatted';
}

String formatCount(num value) => NumberFormat('#,##0').format(value.round());

String formatDelta(num current, num previous) {
  if (previous <= 0 && current <= 0) return '+0.0%';
  if (previous <= 0) return current > 0 ? '+100.0%' : '+0.0%';
  final pct = ((current - previous) / previous) * 100;
  final sign = pct >= 0 ? '+' : '';
  return '$sign${pct.toStringAsFixed(1)}%';
}

DateTime dateOnly(DateTime dt) => DateTime(dt.year, dt.month, dt.day);

AppSnapshot buildSnapshot({
  required List<dynamic> sales,
  required List<dynamic> products,
  required List<dynamic> branches,
  Map<String, dynamic>? settings,
  String selectedBranch = 'All Branches',
  PeriodFilter? period,
}) {
  final range = period ?? PeriodFilter.today();
  final prior = range.previous;
  final symbol = _currencySymbol(settings);

  final branchIdByName = <String, String>{};
  final branchNameById = <String, String>{};
  for (final raw in branches) {
    if (raw is! Map) continue;
    final id = (raw['id'] ?? raw['_id'] ?? '').toString();
    final name = (raw['name'] ?? id).toString();
    if (id.isEmpty) continue;
    branchIdByName[name] = id;
    branchNameById[id] = name;
  }

  String? selectedId;
  if (selectedBranch != 'All Branches') {
    selectedId = branchIdByName[selectedBranch];
  }

  bool inBranch(dynamic sale) {
    if (selectedId == null) return true;
    return (sale['branchId'] ?? '').toString() == selectedId;
  }

  DateTime? saleDate(dynamic sale) {
    final raw = sale['saleCapturedAt'] ?? sale['recordedAt'] ?? sale['created_at'] ?? sale['createdAt'];
    if (raw == null) return null;
    return DateTime.tryParse(raw.toString());
  }

  bool inRange(DateTime? dt, PeriodFilter filter) {
    if (dt == null) return false;
    final day = dateOnly(dt);
    return !day.isBefore(filter.from) && !day.isAfter(filter.to);
  }

  double sumSales(PeriodFilter filter) {
    var total = 0.0;
    for (final sale in sales) {
      if (sale is! Map || !inBranch(sale) || !inRange(saleDate(sale), filter)) continue;
      total += (sale['total'] as num?)?.toDouble() ?? 0;
    }
    return total;
  }

  double sumProfit(PeriodFilter filter) {
    var total = 0.0;
    for (final sale in sales) {
      if (sale is! Map || !inBranch(sale) || !inRange(saleDate(sale), filter)) continue;
      total += (sale['profitTotal'] as num?)?.toDouble() ?? 0;
    }
    return total;
  }

  int countTx(PeriodFilter filter) {
    var count = 0;
    for (final sale in sales) {
      if (sale is! Map || !inBranch(sale) || !inRange(saleDate(sale), filter)) continue;
      count += 1;
    }
    return count;
  }

  int countItems(PeriodFilter filter) {
    var qty = 0;
    for (final sale in sales) {
      if (sale is! Map || !inBranch(sale) || !inRange(saleDate(sale), filter)) continue;
      final items = sale['items'];
      if (items is List) {
        for (final item in items) {
          if (item is Map) qty += ((item['qty'] as num?)?.toInt() ?? 0);
        }
      }
    }
    return qty;
  }

  final currentSales = sumSales(range);
  final priorSales = sumSales(prior);
  final currentProfit = sumProfit(range);
  final priorProfit = sumProfit(prior);
  final currentTx = countTx(range);
  final priorTx = countTx(prior);
  final currentItems = countItems(range);
  final priorItems = countItems(prior);
  final avg = currentTx == 0 ? 0.0 : currentSales / currentTx;
  final priorAvg = priorTx == 0 ? 0.0 : priorSales / priorTx;

  final trend = _trendPoints(range, (day) => sumSales(PeriodFilter(label: '', from: day, to: day)));

  const icons = [
    Icons.phone_iphone_rounded,
    Icons.headphones_rounded,
    Icons.battery_charging_full_rounded,
    Icons.devices_other_rounded,
  ];
  final productQty = <String, int>{};
  final sellerTotals = <String, double>{};
  final records = <SaleRecord>[];
  for (final sale in sales) {
    if (sale is! Map || !inBranch(sale)) continue;
    final dt = saleDate(sale);
    if (!inRange(dt, range)) continue;
    final items = sale['items'];
    var itemCount = 0;
    if (items is List) {
      for (final item in items) {
        if (item is! Map) continue;
        final qty = (item['qty'] as num?)?.toInt() ?? 0;
        itemCount += qty;
        final name = (item['name'] ?? 'Item').toString();
        productQty[name] = (productQty[name] ?? 0) + qty;
      }
    }
    final total = (sale['total'] as num?)?.toDouble() ?? 0;
    final sellerRaw = (sale['sellerName'] ?? sale['cashierName'] ?? sale['user'] ?? '').toString().trim();
    final seller = sellerRaw.isEmpty ? 'Unknown' : sellerRaw;
    sellerTotals[seller] = (sellerTotals[seller] ?? 0) + total;
    final branchId = (sale['branchId'] ?? '').toString();
    records.add(SaleRecord(
      id: (sale['_id'] ?? sale['clientId'] ?? sale['receiptNumber'] ?? '').toString(),
      when: dt,
      branch: branchNameById[branchId] ?? branchId,
      seller: seller,
      totalLabel: formatMoney(total, symbol),
      totalValue: total,
      items: itemCount,
      receipt: (sale['receiptNumber'] ?? sale['invoiceSerial'] ?? '').toString(),
    ));
  }
  records.sort((a, b) => (b.when ?? DateTime(0)).compareTo(a.when ?? DateTime(0)));

  final ranked = productQty.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
  final maxQty = ranked.isEmpty ? 1 : ranked.first.value;
  final topProducts = <ProductSale>[
    for (var i = 0; i < ranked.take(5).length; i++)
      ProductSale(
        name: ranked[i].key,
        units: ranked[i].value,
        share: ranked[i].value / maxQty,
        icon: icons[i % icons.length],
        accent: AppColors.green,
      ),
  ];

  final sellerRanked = sellerTotals.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
  final salespeople = [
    for (final entry in sellerRanked.take(8))
      NamedAmount(name: entry.key, value: entry.value, label: formatMoney(entry.value, symbol)),
  ];

  double stockOf(Map product) {
    var qty = 0.0;
    void addMap(dynamic raw) {
      if (raw is! Map) return;
      if (selectedId != null) {
        qty += (raw[selectedId] as num?)?.toDouble() ?? 0;
        return;
      }
      for (final value in raw.values) {
        qty += (value as num?)?.toDouble() ?? 0;
      }
    }

    addMap(product['stockByBranch']);
    addMap(product['wholesaleStockByBranch']);
    addMap(product['warehouseStockByBranch']);
    final variants = product['variants'];
    if (variants is List) {
      for (final variant in variants) {
        if (variant is Map) {
          addMap(variant['stockByBranch']);
          addMap(variant['wholesaleStockByBranch']);
          addMap(variant['warehouseStockByBranch']);
        }
      }
    }
    return qty;
  }

  var totalUnits = 0.0;
  var stockValue = 0.0;
  var low = 0;
  var out = 0;
  final categoryUnits = <String, double>{};
  final lowItems = <LowStockItem>[];
  for (final raw in products) {
    if (raw is! Map) continue;
    final qty = stockOf(raw);
    totalUnits += qty;
    final price = (raw['costPrice'] as num?)?.toDouble() ?? (raw['price'] as num?)?.toDouble() ?? 0;
    stockValue += qty * price;
    final threshold = (raw['lowStock'] as num?)?.toDouble() ?? 0;
    final name = (raw['name'] ?? 'Item').toString();
    if (qty <= 0) {
      out += 1;
      lowItems.add(LowStockItem(name: name, units: 0, status: 'Out of Stock', icon: Icons.smartphone_rounded));
    } else if (threshold > 0 && qty <= threshold) {
      low += 1;
      lowItems.add(LowStockItem(
        name: name,
        units: qty.round(),
        status: qty <= threshold / 2 ? 'Critical' : 'Low Stock',
        icon: Icons.inventory_2_rounded,
      ));
    }
    final cat = (raw['category'] ?? 'Others').toString();
    categoryUnits[cat] = (categoryUnits[cat] ?? 0) + qty;
  }
  lowItems.sort((a, b) => a.units.compareTo(b.units));

  final catTotal = categoryUnits.values.fold<double>(0, (s, v) => s + v);
  const palette = [AppColors.primary, AppColors.green, AppColors.amber, AppColors.purple, AppColors.pink];
  final catEntries = categoryUnits.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
  final categories = <CategoryShare>[
    for (var i = 0; i < catEntries.take(4).length; i++)
      CategoryShare(
        label: catEntries[i].key.isEmpty ? 'Others' : catEntries[i].key,
        percent: catTotal <= 0 ? 0 : ((catEntries[i].value / catTotal) * 100).round(),
        color: palette[i % palette.length],
      ),
  ];

  final byBranch = <String, double>{};
  var periodItems = 0;
  for (final sale in sales) {
    if (sale is! Map) continue;
    if (!inRange(saleDate(sale), range)) continue;
    final id = (sale['branchId'] ?? '').toString();
    byBranch[id] = (byBranch[id] ?? 0) + ((sale['total'] as num?)?.toDouble() ?? 0);
    final items = sale['items'];
    if (items is List) {
      for (final item in items) {
        if (item is Map) periodItems += ((item['qty'] as num?)?.toInt() ?? 0);
      }
    }
  }
  final periodTotal = byBranch.values.fold<double>(0, (s, v) => s + v);
  final maxBranch = byBranch.values.fold<double>(0, (s, v) => v > s ? v : s);
  const barColors = [AppColors.green, AppColors.primary, AppColors.orange, AppColors.red, AppColors.purple];
  final branchPerf = <BranchPerf>[];
  var i = 0;
  final ordered = byBranch.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
  for (final entry in ordered) {
    final name = branchNameById[entry.key] ?? entry.key;
    if (name.isEmpty) continue;
    final percent = maxBranch <= 0 ? 0 : ((entry.value / maxBranch) * 100).round();
    branchPerf.add(BranchPerf(
      name: name,
      sales: formatMoney(entry.value, symbol),
      percent: percent == 0 ? 1 : percent,
      color: barColors[i % barColors.length],
    ));
    i += 1;
  }

  final stockByBranchId = <String, double>{};
  void addStockMap(dynamic raw) {
    if (raw is! Map) return;
    raw.forEach((key, value) {
      final id = key.toString();
      if (id.isEmpty) return;
      stockByBranchId[id] = (stockByBranchId[id] ?? 0) + ((value as num?)?.toDouble() ?? 0);
    });
  }

  for (final raw in products) {
    if (raw is! Map) continue;
    addStockMap(raw['stockByBranch']);
    addStockMap(raw['wholesaleStockByBranch']);
    addStockMap(raw['warehouseStockByBranch']);
    final variants = raw['variants'];
    if (variants is List) {
      for (final variant in variants) {
        if (variant is Map) {
          addStockMap(variant['stockByBranch']);
          addStockMap(variant['wholesaleStockByBranch']);
          addStockMap(variant['warehouseStockByBranch']);
        }
      }
    }
  }
  final maxStock = stockByBranchId.values.fold<double>(0, (s, v) => v > s ? v : s);
  final stockOrdered = stockByBranchId.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
  final branchStock = <BranchPerf>[];
  var stockIndex = 0;
  for (final entry in stockOrdered) {
    final name = branchNameById[entry.key] ?? entry.key;
    if (name.isEmpty) continue;
    final percent = maxStock <= 0 ? 0 : ((entry.value / maxStock) * 100).round();
    branchStock.add(BranchPerf(
      name: name,
      sales: '${formatCount(entry.value)} units',
      percent: percent == 0 && entry.value > 0 ? 1 : percent,
      color: barColors[stockIndex % barColors.length],
    ));
    stockIndex += 1;
  }

  final names = ['All Branches', ...branchNameById.values.where((n) => n.isNotEmpty)];
  final top = branchPerf.isNotEmpty
      ? branchPerf.first
      : const BranchPerf(name: '—', sales: '₵0', percent: 0, color: AppColors.primary);
  final achieved = maxBranch <= 0 ? 0 : 100;

  return AppSnapshot(
    currencySymbol: symbol,
    heroSales: formatMoney(currentSales, symbol),
    heroDelta: formatDelta(currentSales, priorSales),
    profit: formatMoney(currentProfit, symbol),
    profitDelta: formatDelta(currentProfit, priorProfit),
    transactions: formatCount(currentTx),
    txDelta: formatDelta(currentTx.toDouble(), priorTx.toDouble()),
    itemsSold: formatCount(currentItems),
    itemsDelta: formatDelta(currentItems.toDouble(), priorItems.toDouble()),
    activeBranches: formatCount(branchNameById.length),
    avgSale: formatMoney(avg, symbol),
    avgDelta: formatDelta(avg, priorAvg),
    stockValue: formatMoney(stockValue, symbol),
    totalStock: formatCount(totalUnits),
    lowStockCount: formatCount(low),
    outOfStockCount: formatCount(out),
    weekTrend: trend,
    salesLine: trend,
    topProducts: topProducts,
    lowStock: lowItems,
    categories: categories,
    branchPerf: branchPerf,
    branchStock: branchStock,
    branchNames: names,
    monthSales: formatMoney(periodTotal, symbol),
    monthItems: formatCount(periodItems),
    targetAchieved: '${achieved.clamp(0, 100)}%',
    topBranchName: top.name,
    topBranchSales: top.sales,
    live: true,
    periodLabel: range.label,
    comparisonLabel: range.vsLabel,
    trendRangeLabel: range.label,
    sales: records,
    salespeople: salespeople,
    lastSynced: DateTime.now(),
  );
}

String _currencySymbol(Map<String, dynamic>? settings) {
  if (settings == null) return '₵';
  final direct = settings['currencySymbol'];
  if (direct != null && direct.toString().trim().isNotEmpty) return direct.toString();
  final currencies = settings['currencies'];
  if (currencies is List && currencies.isNotEmpty && currencies.first is Map) {
    final symbol = (currencies.first as Map)['symbol'];
    if (symbol != null) return symbol.toString();
  }
  return '₵';
}

List<TrendPoint> _trendPoints(PeriodFilter range, double Function(DateTime day) valueForDay) {
  final days = range.to.difference(range.from).inDays + 1;
  final points = <TrendPoint>[];
  if (days <= 8) {
    for (var i = 0; i < days; i++) {
      final day = range.from.add(Duration(days: i));
      final isLast = i == days - 1;
      final label = isLast && range.label == 'Today'
          ? 'Today'
          : const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day.weekday - 1];
      points.add(TrendPoint(label, valueForDay(day)));
    }
    return points;
  }
  if (days <= 31) {
    const step = 3;
    for (var i = 0; i < days; i += step) {
      final start = range.from.add(Duration(days: i));
      final end = start.add(const Duration(days: step - 1));
      final clampEnd = end.isAfter(range.to) ? range.to : end;
      var total = 0.0;
      for (var d = start; !d.isAfter(clampEnd); d = d.add(const Duration(days: 1))) {
        total += valueForDay(d);
      }
      points.add(TrendPoint('${start.day}/${start.month}', total));
    }
    return points;
  }
  var cursor = range.from;
  while (!cursor.isAfter(range.to)) {
    final weekEnd = cursor.add(const Duration(days: 6));
    final clampEnd = weekEnd.isAfter(range.to) ? range.to : weekEnd;
    var total = 0.0;
    for (var d = cursor; !d.isAfter(clampEnd); d = d.add(const Duration(days: 1))) {
      total += valueForDay(d);
    }
    points.add(TrendPoint('${cursor.day}/${cursor.month}', total));
    cursor = clampEnd.add(const Duration(days: 1));
  }
  return points;
}
