import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const [companies, branches, warehouses, users, products, suppliers, flags] = await Promise.all([
    prisma.company.count(),
    prisma.branch.count(),
    prisma.warehouse.count(),
    prisma.user.count(),
    prisma.product.count(),
    prisma.supplier.count(),
    prisma.featureFlag.count(),
  ]);
  assert.ok(companies > 0, 'seed harus memiliki company');
  assert.ok(branches > 0, 'seed harus memiliki branch');
  assert.ok(warehouses > 0, 'seed harus memiliki warehouse');
  assert.ok(users > 0, 'seed harus memiliki user');
  const seedMode = (process.env.SEED_MODE ?? ((process.env.DATABASE_PROFILE ?? '').toLowerCase() === 'postgresql' ? 'bootstrap' : 'demo')).toLowerCase();
  if (seedMode === 'demo') {
    assert.ok(products > 0, 'seed demo harus memiliki product');
    assert.ok(suppliers > 0, 'seed demo harus memiliki supplier');
  } else {
    assert.equal(seedMode, 'bootstrap', `SEED_MODE tidak dikenal: ${seedMode}`);
    // Bootstrap boleh dijalankan pada database staging yang sudah memiliki data riil; tidak mewajibkan fixture demo.
  }
  assert.ok(flags > 0, 'seed harus memiliki feature flag');
  console.log({ databaseProfile: process.env.DATABASE_PROFILE ?? 'unknown', seedMode, companies, branches, warehouses, users, products, suppliers, flags });
} finally {
  await prisma.$disconnect();
}
