import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api_client.dart';
import '../state/app_session.dart';
import '../theme/app_colors.dart';
import '../widgets/brand_logo.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session, required this.onLoggedIn});

  final AppSession session;
  final VoidCallback onLoggedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _tenant = TextEditingController();
  final _username = TextEditingController();
  final _pin = TextEditingController();
  bool _remember = true;
  bool _pinVisible = false;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  Future<void> _hydrate() async {
    final saved = await widget.session.remembered();
    if (!mounted) return;
    setState(() {
      _tenant.text = saved['tenantId'] ?? 'master';
      _username.text = saved['username'] ?? '';
      _pin.text = saved['pin'] ?? '';
    });
  }

  @override
  void dispose() {
    _tenant.dispose();
    _username.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final tenant = _tenant.text.trim();
    final username = _username.text.trim();
    final pin = _pin.text.trim();
    if (tenant.isEmpty || username.isEmpty) {
      setState(() => _error = 'Enter tenant ID, username and PIN');
      return;
    }
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin)) {
      setState(() => _error = 'PIN must be 4-6 digits');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    await widget.session.rememberCredentials(
      tenant: tenant,
      user: username,
      pin: pin,
      remember: _remember,
    );
    try {
      await widget.session.signIn(tenant: tenant, user: username, pin: pin);
      if (!mounted) return;
      setState(() => _loading = false);
      widget.onLoggedIn();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 430),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
              child: Column(
                children: [
                  const BrandLogo(size: 56, radius: 16),
                  const SizedBox(height: 10),
                  const Text(
                    'ptSales',
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: AppColors.text),
                  ),
                  const Text(
                    'POS SYSTEM',
                    style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.4,
                      fontWeight: FontWeight.w700,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(18, 20, 18, 18),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      boxShadow: const [
                        BoxShadow(color: AppColors.shadow, blurRadius: 24, offset: Offset(0, 10)),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Online Login',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.w800,
                            fontSize: 12,
                            letterSpacing: 0.4,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Welcome back',
                          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.text),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Sign in with your tenant ID, username and PIN.',
                          style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: 18),
                        _Field(
                          controller: _tenant,
                          label: 'Tenant ID',
                          hint: 'tenant id',
                          icon: Icons.apartment_rounded,
                        ),
                        const SizedBox(height: 12),
                        _Field(
                          controller: _username,
                          label: 'Username',
                          hint: 'username',
                          icon: Icons.person_outline_rounded,
                        ),
                        const SizedBox(height: 12),
                        _Field(
                          controller: _pin,
                          label: 'PIN',
                          hint: 'PIN (4-6 digits)',
                          icon: Icons.lock_outline_rounded,
                          obscure: !_pinVisible,
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(6),
                          ],
                          suffix: IconButton(
                            onPressed: () => setState(() => _pinVisible = !_pinVisible),
                            icon: Icon(
                              _pinVisible ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                              color: AppColors.muted,
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Checkbox(
                              value: _remember,
                              activeColor: AppColors.primary,
                              onChanged: (v) => setState(() => _remember = v ?? true),
                            ),
                            const Text(
                              'remember PIN',
                              style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.mutedStrong),
                            ),
                          ],
                        ),
                        if (_error != null) ...[
                          Text(_error!, style: const TextStyle(color: AppColors.red, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 8),
                        ],
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: FilledButton(
                            onPressed: _loading ? null : _submit,
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            ),
                            child: _loading
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                  )
                                : const Text(
                                    'Log In',
                                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                                  ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Secure access for managers, cashiers and staff',
                    style: TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    this.obscure = false,
    this.keyboardType,
    this.inputFormatters,
    this.suffix,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final bool obscure;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final Widget? suffix;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: AppColors.mutedStrong)),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          inputFormatters: inputFormatters,
          textInputAction: TextInputAction.next,
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: Icon(icon, color: AppColors.muted),
            suffixIcon: suffix,
            filled: true,
            fillColor: const Color(0xFFF8FAFC),
            hintStyle: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500),
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: AppColors.border),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: AppColors.border),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: AppColors.primary, width: 1.4),
            ),
          ),
        ),
      ],
    );
  }
}
