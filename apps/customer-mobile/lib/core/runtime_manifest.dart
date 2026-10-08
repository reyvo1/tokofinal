import 'dart:convert';
import 'package:http/http.dart' as http;

class RuntimeManifest {
  RuntimeManifest({required this.features, required this.modules, required this.settings});
  final Map<String, dynamic> features;
  final List<dynamic> modules;
  final Map<String, dynamic> settings;

  bool enabled(String key) => features[key]?['enabled'] == true;

  static Future<RuntimeManifest> load(String apiBaseUrl, {required String branchCode}) async {
    final uri = Uri.parse('$apiBaseUrl/platform/manifest').replace(queryParameters: {'branchCode': branchCode});
    final response = await http.get(uri);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Runtime manifest failed: ${response.statusCode}');
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return RuntimeManifest(
      features: (json['features'] as Map?)?.cast<String, dynamic>() ?? {},
      modules: (json['modules'] as List?) ?? [],
      settings: (json['settings'] as Map?)?.cast<String, dynamic>() ?? {},
    );
  }
}
