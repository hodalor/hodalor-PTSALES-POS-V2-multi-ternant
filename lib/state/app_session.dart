import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../data/models.dart';
import '../data/snapshot.dart';

class AppSession extends ChangeNotifier {
  AppSession({ApiClient? apiClient}) : client = apiClient ?? ApiClient();

  final ApiClient client;
  bool isLoggedIn = false;
  String tenantId = '';
  String username = '';
  String role = 'Manager';
  String selectedBranch = 'All Branches';
  PeriodFilter period = PeriodFilter.today();
  List<String> grants = const [];
  int unreadNotifications = 0;
  AppSnapshot snapshot = AppSnapshot.empty();
  String? syncError;
  bool syncing = false;
  Timer? _poll;

  List<dynamic> sales = const [];
  List<dynamic> products = const [];
  List<dynamic> branches = const [];
  List<dynamic> expenses = const [];
  List<dynamic> approvals = const [];
  List<dynamic> users = const [];
  List<dynamic> transfers = const [];
  List<dynamic> refunds = const [];
  List<dynamic> purchases = const [];
  List<dynamic> adjustments = const [];
  List<dynamic> reconciliations = const [];
  Map<String, dynamic>? settings;

  int get pendingApprovals {
    return approvals.where((row) {
      if (row is! Map) return false;
      final status = (row['status'] ?? '').toString().toLowerCase();
      return status.contains('pending');
    }).length;
  }

  Future<void> restore() async {
    await client.load();
    final prefs = await SharedPreferences.getInstance();
    tenantId = prefs.getString('tenantId') ?? '';
    username = prefs.getString('username') ?? '';
    notifyListeners();
  }

  Future<Map<String, String>> remembered() async {
    final prefs = await SharedPreferences.getInstance();
    return {
      'tenantId': prefs.getString('tenantId') ?? 'master',
      'username': prefs.getString('username') ?? '',
      'pin': (prefs.getBool('rememberPin') ?? false) ? (prefs.getString('pin') ?? '') : '',
    };
  }

  Future<void> rememberCredentials({
    required String tenant,
    required String user,
    required String pin,
    required bool remember,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('tenantId', tenant);
    await prefs.setString('username', user);
    if (remember) {
      await prefs.setString('pin', pin);
      await prefs.setBool('rememberPin', true);
    } else {
      await prefs.remove('pin');
      await prefs.setBool('rememberPin', false);
    }
  }

  Future<void> signIn({
    required String tenant,
    required String user,
    required String pin,
  }) async {
    final resp = await client.login(tenant: tenant, user: user, pin: pin);
    final userMap = resp['user'] is Map ? Map<String, dynamic>.from(resp['user'] as Map) : <String, dynamic>{};
    isLoggedIn = true;
    tenantId = (userMap['tenantId'] ?? tenant).toString();
    username = (userMap['name'] ?? user).toString();
    role = (resp['role'] ?? 'Manager').toString();
    grants = (resp['grants'] is List) ? List<String>.from(resp['grants'] as List) : const [];
    syncError = null;
    snapshot = AppSnapshot.empty(period: period);
    notifyListeners();
    await refresh();
    _startPolling();
  }

  Future<void> refresh() async {
    if (!isLoggedIn || client.token == null) return;
    syncing = true;
    notifyListeners();
    try {
      Future<List<dynamic>> listOrEmpty(String path, {Map<String, String>? query}) async {
        try {
          final data = await client.request(path, query: query);
          if (data is List) return List<dynamic>.from(data);
          if (data is Map && data['data'] is List) return List<dynamic>.from(data['data'] as List);
          return <dynamic>[];
        } catch (_) {
          return <dynamic>[];
        }
      }

      final results = await Future.wait([
        listOrEmpty('/api/sales', query: {'all': '1'}),
        listOrEmpty('/api/products'),
        listOrEmpty('/api/branches'),
        client.request('/api/settings').then<dynamic>((v) => v).catchError((_) => null),
        listOrEmpty('/api/expenses'),
        listOrEmpty('/api/approvals'),
        listOrEmpty('/api/users'),
        listOrEmpty('/api/transfers/requests'),
        listOrEmpty('/api/refunds/requests'),
        listOrEmpty('/api/purchases/requests'),
        listOrEmpty('/api/adjustments/requests'),
        listOrEmpty('/api/cash-reconciliations'),
      ]);
      sales = results[0] as List<dynamic>;
      products = results[1] as List<dynamic>;
      branches = results[2] as List<dynamic>;
      final settingsRaw = results[3];
      if (settingsRaw is Map) {
        settings = Map<String, dynamic>.from(settingsRaw['data'] is Map ? settingsRaw['data'] as Map : settingsRaw);
      }
      expenses = results[4] as List<dynamic>;
      approvals = results[5] as List<dynamic>;
      users = results[6] as List<dynamic>;
      transfers = results[7] as List<dynamic>;
      refunds = results[8] as List<dynamic>;
      purchases = results[9] as List<dynamic>;
      adjustments = results[10] as List<dynamic>;
      reconciliations = results[11] as List<dynamic>;
      unreadNotifications = pendingApprovals;
      _rebuild();
      syncError = null;
    } catch (e) {
      syncError = e.toString();
    } finally {
      syncing = false;
      notifyListeners();
    }
  }

  void _rebuild() {
    snapshot = buildSnapshot(
      sales: sales,
      products: products,
      branches: branches,
      settings: settings,
      selectedBranch: selectedBranch,
      period: period,
    );
  }

  void setPeriod(PeriodFilter next) {
    period = next;
    _rebuild();
    notifyListeners();
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 25), (_) => refresh());
  }

  Future<void> logout() async {
    _poll?.cancel();
    try {
      await client.request('/api/auth/logout', method: 'POST');
    } catch (_) {}
    await client.clearSession();
    isLoggedIn = false;
    grants = const [];
    sales = const [];
    products = const [];
    branches = const [];
    expenses = const [];
    approvals = const [];
    users = const [];
    transfers = const [];
    refunds = const [];
    purchases = const [];
    adjustments = const [];
    reconciliations = const [];
    snapshot = AppSnapshot.empty();
    syncError = null;
    notifyListeners();
  }

  void setBranch(String value) {
    selectedBranch = value;
    _rebuild();
    notifyListeners();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }
}
