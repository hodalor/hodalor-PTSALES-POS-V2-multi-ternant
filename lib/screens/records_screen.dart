import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../data/snapshot.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/brand_logo.dart';
import '../widgets/common.dart';

class RecordRow {
  const RecordRow({
    required this.title,
    this.subtitle = '',
    this.trailing = '',
    this.badgeTone,
  });

  final String title;
  final String subtitle;
  final String trailing;
  final String? badgeTone;
}

class RecordsScreen extends StatefulWidget {
  const RecordsScreen({
    super.key,
    required this.title,
    required this.subtitle,
    required this.session,
    required this.rowsFor,
  });

  final String title;
  final String subtitle;
  final AppSession session;
  final List<RecordRow> Function(AppSession session) rowsFor;

  @override
  State<RecordsScreen> createState() => _RecordsScreenState();
}

class _RecordsScreenState extends State<RecordsScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.session,
      builder: (context, _) {
        final q = _query.trim().toLowerCase();
        final rows = widget.rowsFor(widget.session).where((row) {
          if (q.isEmpty) return true;
          return row.title.toLowerCase().contains(q) ||
              row.subtitle.toLowerCase().contains(q) ||
              row.trailing.toLowerCase().contains(q);
        }).toList();

        return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: const BrandLockup(compact: true),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text(widget.subtitle, style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500)),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: InputDecoration(
                hintText: 'Search',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.muted),
                filled: true,
                fillColor: Colors.white,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: widget.session.refresh,
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                itemCount: rows.isEmpty ? 1 : rows.length,
                itemBuilder: (context, index) {
                  if (rows.isEmpty) {
                    return const PtCard(child: EmptyHint('No live records for this tenant yet'));
                  }
                  final row = rows[index];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: PtCard(
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(row.title, style: const TextStyle(fontWeight: FontWeight.w800)),
                                if (row.subtitle.isNotEmpty)
                                  Text(
                                    row.subtitle,
                                    style: const TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600),
                                  ),
                              ],
                            ),
                          ),
                          if (row.badgeTone != null)
                            StatusBadge(label: row.trailing.isEmpty ? row.badgeTone! : row.trailing, tone: row.badgeTone!)
                          else if (row.trailing.isNotEmpty)
                            Flexible(
                              child: Text(
                                row.trailing,
                                textAlign: TextAlign.right,
                                style: const TextStyle(fontWeight: FontWeight.w800),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
      },
    );
  }
}

String pick(Map row, List<String> keys, [String fallback = '—']) {
  for (final key in keys) {
    final value = row[key];
    if (value == null) continue;
    final text = value.toString().trim();
    if (text.isNotEmpty && text != 'null') return text;
  }
  return fallback;
}

String pickDate(Map row, [List<String> keys = const ['date', 'createdAt', 'created_at', 'updatedAt']]) {
  for (final key in keys) {
    final value = row[key];
    if (value == null) continue;
    final dt = DateTime.tryParse(value.toString());
    if (dt != null) return DateFormat('d MMM yyyy, HH:mm').format(dt.toLocal());
  }
  return '';
}

String pickMoney(Map row, AppSession session, [List<String> keys = const ['amount', 'total', 'requestedAmount']]) {
  for (final key in keys) {
    final value = row[key];
    if (value is num) return formatMoney(value, session.snapshot.currencySymbol);
  }
  return '';
}

List<RecordRow> mapGeneric(List<dynamic> source, AppSession session) {
  return [
    for (final raw in source)
      if (raw is Map)
        RecordRow(
          title: pick(raw, ['name', 'title', 'category', 'actionType', 'productName', 'receiptNumber', 'status']),
          subtitle: [
            pick(raw, ['note', 'reason', 'remark', 'role', 'initiatedByName', 'sellerName', 'createdBy'], ''),
            pickDate(raw),
            pick(raw, ['branchId', 'from', 'to', 'fromBranchId', 'toBranchId'], ''),
          ].where((part) => part.isNotEmpty && part != '—').join(' · '),
          trailing: pickMoney(raw, session).isNotEmpty
              ? pickMoney(raw, session)
              : pick(raw, ['status', 'qty', 'quantity', 'role'], ''),
          badgeTone: (pick(raw, ['status'], '').toLowerCase().contains('pending'))
              ? 'warn'
              : (pick(raw, ['status'], '').toLowerCase().contains('reject') ? 'danger' : null),
        ),
  ];
}
