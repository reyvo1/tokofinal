import { Module } from '@nestjs/common';
import { StaffMemosController } from './staff-memos.controller';
import { StaffMemosService } from './staff-memos.service';

@Module({ controllers: [StaffMemosController], providers: [StaffMemosService] })
export class StaffMemosModule {}
