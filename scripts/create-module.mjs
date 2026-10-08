import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const raw = process.argv[2];
if (!raw || !/^[a-z][a-z0-9-]*$/.test(raw)) {
  console.error('Usage: node scripts/create-module.mjs <kebab-case-name>'); process.exit(1);
}
const pascal = raw.split('-').map((part) => part[0].toUpperCase()+part.slice(1)).join('');
const dir = resolve('apps/api/src',raw);
if (existsSync(dir)) { console.error(`Module ${raw} already exists.`); process.exit(1); }
mkdirSync(resolve(dir,'dto'),{recursive:true});
writeFileSync(resolve(dir,`${raw}.service.ts`),`import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class ${pascal}Service {\n  health() { return { module: '${raw}', ok: true }; }\n}\n`);
writeFileSync(resolve(dir,`${raw}.controller.ts`),`import { Controller, Get } from '@nestjs/common';\nimport { ApiBearerAuth, ApiTags } from '@nestjs/swagger';\nimport { ${pascal}Service } from './${raw}.service';\n\n@ApiTags('${raw}') @ApiBearerAuth() @Controller('${raw}')\nexport class ${pascal}Controller {\n  constructor(private readonly service: ${pascal}Service) {}\n  @Get('health') health() { return this.service.health(); }\n}\n`);
writeFileSync(resolve(dir,`${raw}.module.ts`),`import { Module } from '@nestjs/common';\nimport { ${pascal}Controller } from './${raw}.controller';\nimport { ${pascal}Service } from './${raw}.service';\n\n@Module({ controllers: [${pascal}Controller], providers: [${pascal}Service] })\nexport class ${pascal}Module {}\n`);
writeFileSync(resolve(dir,'README.md'),`# ${pascal} Module\n\nAdd Prisma schema, DTO validation, permissions, feature flag, module catalog seed, events, tests, and AppModule registration.\n`);
console.log(`Created ${dir}. Register ${pascal}Module in apps/api/src/app.module.ts.`);
