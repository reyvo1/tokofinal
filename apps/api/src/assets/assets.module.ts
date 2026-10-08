import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
@Module({ imports: [PrismaModule, AccountingCoreModule], controllers: [AssetsController], providers: [AssetsService], exports: [AssetsService] })
export class AssetsModule {}
