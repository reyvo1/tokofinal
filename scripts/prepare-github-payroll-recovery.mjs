import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function model(name) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === name);
  if (!m) throw new Error(`Prisma model ${name} tidak ditemukan.`);
  return m;
}

function cloneScalars(modelName, source, overrides, omit = new Set()) {
  const data = {};
  for (const field of model(modelName).fields) {
    if (!['scalar', 'enum'].includes(field.kind)) continue;
    if (omit.has(field.name)) continue;
    if (Object.hasOwn(overrides, field.name)) data[field.name] = overrides[field.name];
    else if (Object.hasOwn(source, field.name)) data[field.name] = source[field.name];
  }
  return data;
}

async function main() {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) throw new Error('Company hasil seed tidak ditemukan.');

  const branch = await prisma.branch.findFirst({
    where: { companyId: company.id, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) throw new Error('Branch aktif hasil seed tidak ditemukan.');

  await prisma.$transaction(async (tx) => {
    let account = await tx.account.findFirst({ where: { branchId: branch.id, code: '1202' } });
    if (!account) {
      const template = await tx.account.findFirst({
        where: { branchId: branch.id, code: '1201', type: 'ASSET', isActive: true },
      });
      if (!template) throw new Error('Template account 1201 Piutang Usaha tidak ditemukan.');
      account = await tx.account.create({
        data: cloneScalars('Account', template, {
          code: '1202',
          name: 'Piutang Karyawan',
          type: 'ASSET',
          isActive: true,
        }, new Set(['id', 'createdAt', 'updatedAt'])),
      });
    }

    let mapping = await tx.payrollAccountingMapping.findFirst({
      where: { companyId: company.id, componentCode: '__PAYROLL_RECEIVABLE__' },
      orderBy: { branchId: 'desc' },
    });

    if (mapping) {
      await tx.payrollAccountingMapping.update({
        where: { id: mapping.id },
        data: { branchId: branch.id, debitAccountId: account.id, isActive: true },
      });
    } else {
      await tx.payrollAccountingMapping.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          componentCode: '__PAYROLL_RECEIVABLE__',
          debitAccountId: account.id,
          isActive: true,
        },
      });
    }

    const lines = [
      { side: 'DEBIT', amountKey: 'gross', accountCodeKey: 'settlement' },
      { side: 'CREDIT', amountKey: 'gross', accountCodeKey: 'payrollReceivable' },
    ];

    let rule = await tx.accountingPostingRule.findFirst({
      where: { companyId: company.id, eventType: 'PAYROLL_EMPLOYEE_RECOVERY' },
      orderBy: { version: 'desc' },
    });

    if (rule) {
      await tx.accountingPostingRule.update({
        where: { id: rule.id },
        data: { status: 'ACTIVE', journalLines: lines },
      });
    } else {
      const template = await tx.accountingPostingRule.findFirst({
        where: { companyId: company.id, eventType: 'PAYROLL_POSTED', status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      if (!template) throw new Error('Template PAYROLL_POSTED rule tidak ditemukan.');
      await tx.accountingPostingRule.create({
        data: cloneScalars('AccountingPostingRule', template, {
          code: 'PAYROLL-EMPLOYEE-RECOVERY',
          name: 'PAYROLL-EMPLOYEE-RECOVERY',
          eventType: 'PAYROLL_EMPLOYEE_RECOVERY',
          version: 1,
          status: 'ACTIVE',
          journalLines: lines,
        }, new Set(['id', 'createdAt', 'updatedAt'])),
      });
    }
  });

  console.log('GitHub payroll recovery fixture PASS.');
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
