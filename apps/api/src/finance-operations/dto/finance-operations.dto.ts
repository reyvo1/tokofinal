import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

enum FinanceTransactionTypeDto {
  OPERATING_EXPENSE='OPERATING_EXPENSE', OTHER_INCOME='OTHER_INCOME', CUSTOMER_RECEIPT='CUSTOMER_RECEIPT',
  SUPPLIER_PAYMENT='SUPPLIER_PAYMENT', SUPPLIER_REFUND='SUPPLIER_REFUND', TAX_PAYMENT='TAX_PAYMENT', PAYROLL_LIABILITY_PAYMENT='PAYROLL_LIABILITY_PAYMENT', CASH_TRANSFER='CASH_TRANSFER',
  BANK_TRANSFER='BANK_TRANSFER', OTHER='OTHER',
}

export class CreateFinanceTransactionDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' })
  @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' })
  @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ enum: FinanceTransactionTypeDto }) @IsEnum(FinanceTransactionTypeDto) type!: FinanceTransactionTypeDto;
  @ApiProperty() @IsString() description!: string;
  @ApiProperty({ example: 1000000 }) @IsNumber() @Min(0) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
  @ApiProperty() @IsString() debitAccountCode!: string;
  @ApiProperty() @IsString() creditAccountCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxAccountCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() counterpartyType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() counterpartyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() counterpartyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentMethod?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() referenceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() referenceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() transactionDate?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() requireApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() evidence?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Operation key stabil untuk retry aman; alternatifnya kirim header Idempotency-Key.' }) @IsOptional() @IsString() @MaxLength(200) idempotencyKey?: string;
}

export class ApproveFinanceTransactionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
