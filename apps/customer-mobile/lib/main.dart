import 'package:flutter/material.dart';
import 'features/catalog/catalog_screen.dart';

void main() => runApp(const Toko360CustomerApp());

class Toko360CustomerApp extends StatelessWidget {
  const Toko360CustomerApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Toko360',
    theme: ThemeData(useMaterial3: true),
    home: const CatalogScreen(),
  );
}
