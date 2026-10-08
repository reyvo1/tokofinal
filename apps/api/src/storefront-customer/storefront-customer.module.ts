import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorefrontCustomerController } from './storefront-customer.controller';
import { StorefrontCustomerService } from './storefront-customer.service';

@Module({ imports: [PrismaModule], controllers: [StorefrontCustomerController], providers: [StorefrontCustomerService], exports: [StorefrontCustomerService] })
export class StorefrontCustomerModule {}
