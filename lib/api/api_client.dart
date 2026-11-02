import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.status, this.network = false});
  final String message;
  final int? status;
  final bool network;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient();

  static const _baseKey = 'apiBaseUrl';
  static const _tokenKey = 'ptSales:authToken';
  static const _tenantKey = 'ptSales:tenantId';

  String baseUrl = 'http://localhost:4000';
  String? token;
  String? tenantId;
  String? role;
  String? username;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_baseKey);
    baseUrl = (saved ?? defaultBaseUrl()).replaceAll(RegExp(r'/+$'), '');
    if (!kIsWeb &&
        defaultTargetPlatform == TargetPlatform.android &&
        (baseUrl.contains('localhost') || baseUrl.contains('127.0.0.1'))) {
      baseUrl = 'http://10.0.2.2:4000';
    }
    token = prefs.getString(_tokenKey);
    tenantId = prefs.getString(_tenantKey);
  }

  static String defaultBaseUrl() {
    if (kIsWeb) return 'http://localhost:4000';
    if (defaultTargetPlatform == TargetPlatform.android) return 'http://10.0.2.2:4000';
    return 'http://localhost:4000';
  }

  Future<void> persistSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_baseKey, baseUrl);
    if (token != null) await prefs.setString(_tokenKey, token!);
    if (tenantId != null) await prefs.setString(_tenantKey, tenantId!);
  }

  Future<void> clearSession() async {
    token = null;
    role = null;
    username = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
  }

  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    Map<String, String>? query,
  }) async {
    var url = '$baseUrl${path.startsWith('/') ? path : '/$path'}';
    if (method == 'GET') {
      final params = <String, String>{'_': '${DateTime.now().millisecondsSinceEpoch}', ...?query};
      url += (url.contains('?') ? '&' : '?') + Uri(queryParameters: params).query;
    } else if (query != null && query.isNotEmpty) {
      url += (url.contains('?') ? '&' : '?') + Uri(queryParameters: query).query;
    }

    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    };
    if (tenantId != null && tenantId!.isNotEmpty) headers['X-Tenant-Id'] = tenantId!;
    if (role != null && role!.isNotEmpty) headers['X-Role'] = role!;
    if (username != null && username!.isNotEmpty) headers['X-User'] = username!;
    if (token != null && token!.isNotEmpty) headers['Authorization'] = 'Bearer $token';

    http.Response res;
    try {
      final uri = Uri.parse(url);
      switch (method) {
        case 'POST':
          res = await http.post(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 30));
          break;
        case 'PUT':
          res = await http.put(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 30));
          break;
        case 'PATCH':
          res = await http.patch(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 30));
          break;
        default:
          res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 30));
      }
    } catch (e) {
      throw ApiException('Unable to reach the server. Please check the API and internet connection.', network: true);
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      var message = 'Request failed (HTTP ${res.statusCode})';
      try {
        final parsed = jsonDecode(res.body);
        if (parsed is Map && parsed['error'] != null) message = parsed['error'].toString();
      } catch (_) {}
      throw ApiException(message, status: res.statusCode);
    }
    if (res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> login({
    required String tenant,
    required String user,
    required String pin,
  }) async {
    tenantId = tenant;
    final data = await request('/api/auth/login', method: 'POST', body: {
      'tenantId': tenant,
      'username': user,
      'pin': pin,
    });
    final map = Map<String, dynamic>.from(data as Map);
    token = map['token']?.toString();
    role = map['role']?.toString();
    username = (map['user'] is Map ? map['user']['name'] : user)?.toString();
    tenantId = (map['user'] is Map ? map['user']['tenantId'] : tenant)?.toString() ?? tenant;
    await persistSession();
    return map;
  }
}
