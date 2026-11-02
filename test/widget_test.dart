import 'package:flutter_test/flutter_test.dart';
import 'package:ptsales/app.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Login screen shows tenant, username and PIN fields', (tester) async {
    await tester.pumpWidget(const PtSalesApp());
    await tester.pump();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('tenant id'), findsOneWidget);
    expect(find.text('username'), findsOneWidget);
    expect(find.text('PIN (4-6 digits)'), findsOneWidget);
    expect(find.text('Log In'), findsOneWidget);
  });
}
