import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function unique(values) { return [...new Set(values.filter(Boolean))]; }

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true } });
  const fallbackCompanyId = companies.length === 1 ? companies[0].id : null;
  const categories = await prisma.category.findMany({ where: { companyId: null }, select: { id: true, name: true } });
  const customers = await prisma.customer.findMany({ where: { companyId: null }, select: { id: true, name: true } });
  const unresolved = [];
  let categoriesUpdated = 0;
  let customersUpdated = 0;

  for (const category of categories) {
    const products = await prisma.product.findMany({ where: { categoryId: category.id, companyId: { not: null } }, select: { companyId: true } });
    const candidates = unique(products.map((row) => row.companyId));
    const companyId = candidates.length === 1 ? candidates[0] : candidates.length === 0 ? fallbackCompanyId : null;
    if (!companyId) { unresolved.push({ entity: 'Category', id: category.id, name: category.name, candidates }); continue; }
    await prisma.category.update({ where: { id: category.id }, data: { companyId } });
    categoriesUpdated += 1;
  }

  for (const customer of customers) {
    const sales = await prisma.sale.findMany({ where: { customerId: customer.id }, select: { branch: { select: { companyId: true } } }, take: 1000 });
    const candidates = unique(sales.map((row) => row.branch.companyId));
    const companyId = candidates.length === 1 ? candidates[0] : candidates.length === 0 ? fallbackCompanyId : null;
    if (!companyId) { unresolved.push({ entity: 'Customer', id: customer.id, name: customer.name, candidates }); continue; }
    await prisma.customer.update({ where: { id: customer.id }, data: { companyId } });
    customersUpdated += 1;
  }

  if (unresolved.length) {
    console.error(JSON.stringify({ ok: false, categoriesUpdated, customersUpdated, unresolved }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, categoriesUpdated, customersUpdated, unresolved: [] }, null, 2));
}

main().finally(() => prisma.$disconnect());
