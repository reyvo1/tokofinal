import 'package:flutter/material.dart';

class CatalogScreen extends StatelessWidget {
  const CatalogScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(
    appBar: AppBar(title: Text('Toko360')),
    body: Center(child: Text('Hubungkan ke GET /api/v1/products dan runtime manifest.')),
  );
}
