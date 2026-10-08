import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateBatchDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsString() batchNumber!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() producedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiryDate?: string;
  @ApiPropertyOptional({ default: 0, description: 'Hanya 0 untuk pre-registration. Kuantitas positif harus berasal dari inventory movement canonical.' }) @IsOptional() @IsInt() @Min(0) quantity?: number;
}
export class CreateSerialDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsString() serialNumber!: string;
}
export class CreateLoyaltyProgramDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() earnRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() redemptionRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minimumRedeem?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) pointsExpireDays?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() tiers?: unknown;
  @ApiPropertyOptional() @IsOptional() @Allow() rules?: unknown;
}
export class LoyaltyTransactionDto {
  @ApiProperty() @IsString() programId!: string;
  @ApiProperty() @IsString() customerId!: string;
  @ApiProperty({ enum: ['EARN','REDEEM','ADJUSTMENT','EXPIRE','REFUND'] }) @IsString() type!: string;
  @ApiProperty({ description: 'Gunakan angka negatif untuk REDEEM/EXPIRE.' }) @IsInt() points!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() referenceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() referenceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
export class CreateFiscalPeriodDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsDateString() startDate!: string;
  @ApiProperty() @IsDateString() endDate!: string;
}
export class BankStatementLineDto {
  @ApiProperty() @IsDateString() transactionDate!: string;
  @ApiProperty() @IsString() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() debit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() credit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() balance?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() raw?: unknown;
}
export class ImportBankStatementDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ description: 'Account.id untuk akun bank aset pada branch aktif.' }) @IsString() bankAccountId!: string;
  @ApiProperty() @IsString() source!: string;
  @ApiProperty({ description: 'Identitas idempoten untuk import bank statement.' }) @IsString() fileName!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() periodStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() periodEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() openingBalance?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() closingBalance?: number;
  @ApiProperty({ type: [BankStatementLineDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => BankStatementLineDto) lines!: BankStatementLineDto[];
}
export class CreateReconciliationDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() statementId!: string;
  @ApiPropertyOptional({ description: 'Boleh dikirim untuk cross-check; sumber utama diambil dari bank statement.' }) @IsOptional() @IsString() bankAccountId?: string;
  @ApiProperty() @IsDateString() startDate!: string;
  @ApiProperty() @IsDateString() endDate!: string;
  @ApiPropertyOptional({ description: 'Legacy cross-check only; saldo buku dihitung server dari journal.' }) @IsOptional() @IsNumber() bookBalance?: number;
  @ApiPropertyOptional({ description: 'Legacy cross-check only; saldo bank diambil dari statement.' }) @IsOptional() @IsNumber() bankBalance?: number;
}
export class MatchBankReconciliationDto {
  @ApiProperty() @IsString() statementLineId!: string;
  @ApiProperty() @IsString() journalLineId!: string;
}
export class UnmatchBankReconciliationDto {
  @ApiProperty() @IsString() statementLineId!: string;
}
export class RegisterDeviceDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Legacy compatibility only; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() platform!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() appVersion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() publicKey?: string;
}
export class OfflineTransactionItemDto {
  @ApiProperty() @IsString() localId!: string;
  @ApiProperty() @IsInt() @Min(1) sequence!: number;
  @ApiProperty() @IsString() transactionType!: string;
  @ApiProperty() @Allow() payload!: unknown;
}
export class SubmitOfflineTransactionsDto {
  @ApiProperty({ type: [OfflineTransactionItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => OfflineTransactionItemDto) transactions!: OfflineTransactionItemDto[];
}
export class RotateDeviceCredentialDto {
  @ApiPropertyOptional() @IsOptional() @IsString() publicKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
}
export class SetDeviceStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}
export class AcknowledgeSyncReceiptDto {
  @ApiProperty() @IsString() receiptId!: string;
  @ApiProperty() @IsDateString() checkpoint!: string;
}
export class EdgeSyncPullDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() since?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
export class RunForecastDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Legacy compatibility only; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(7) lookbackDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) horizonDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
}
export class CreateShipmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() saleId?: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() integrationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() carrier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() service?: string;
  @ApiProperty() @IsObject() recipient!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @Allow() packages?: unknown;
}
export class ImportMarketplaceOrderDto {
  @ApiProperty() @IsString() integrationId!: string;
  @ApiProperty() @IsString() externalOrderId!: string;
  @ApiProperty() @IsString() marketplace!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() shopId?: string;
  @ApiProperty() @IsString() status!: string;
  @ApiProperty() @IsObject() orderData!: Record<string, unknown>;
}
export class UpsertNotificationTemplateDto {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty({ enum: ['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM'] })
  @IsString() @IsIn(['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM']) channel!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiProperty() @IsString() body!: string;
  @ApiPropertyOptional({ description: 'Daftar nama variabel template, mis. ["customer.name","order.number"].' })
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class QueueNotificationDto {
  @ApiPropertyOptional({ description: 'Legacy compatibility only; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Legacy compatibility only; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ enum: ['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM'] })
  @IsString() @IsIn(['EMAIL','WHATSAPP','SMS','PUSH','IN_APP','TELEGRAM']) channel!: string;
  @ApiProperty() @IsString() recipient!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() templateCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional({ description: 'Boleh kosong bila templateCode diberikan.' }) @IsOptional() @IsString() body?: string;
  @ApiPropertyOptional({ description: 'Data untuk render {{variable}} dan metadata delivery.' }) @IsOptional() @Allow() data?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledAt?: string;
}

export class UpdateOperatorInsightStatusDto {
  @ApiProperty({ enum: ['ACKNOWLEDGED','DISMISSED'] })
  @IsString() @IsIn(['ACKNOWLEDGED','DISMISSED']) status!: 'ACKNOWLEDGED'|'DISMISSED';
}

export class OperatorAssistantQueryDto {
  @ApiProperty() @IsString() @MaxLength(500) question!: string;
  @ApiPropertyOptional({ enum: ['AUTO','STOCK','FINANCE','AUTOMATION','REPORTING'] })
  @IsOptional() @IsString() @IsIn(['AUTO','STOCK','FINANCE','AUTOMATION','REPORTING']) intent?: 'AUTO'|'STOCK'|'FINANCE'|'AUTOMATION'|'REPORTING';
}

export class MaterializeDailySummariesDto {
  @ApiPropertyOptional({ description: 'Tanggal bisnis YYYY-MM-DD menurut timezone company. Default hari bisnis company saat ini.' }) @IsOptional() @IsDateString() businessDate?: string;
}

export class UpsertDataRetentionPolicyDto {
  @ApiProperty({ enum: ['AUDIT_LOG','ASSISTANT_INTERACTION','OPERATOR_INSIGHT'] })
  @IsString() @IsIn(['AUDIT_LOG','ASSISTANT_INTERACTION','OPERATOR_INSIGHT']) entityType!: 'AUDIT_LOG'|'ASSISTANT_INTERACTION'|'OPERATOR_INSIGHT';
  @ApiPropertyOptional({ default: 365 }) @IsOptional() @IsInt() @Min(1) hotDays?: number;
  @ApiPropertyOptional({ default: 1095 }) @IsOptional() @IsInt() @Min(1) warmDays?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() archiveAfter?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class RunDataArchiveDto {
  @ApiProperty() @IsString() policyId!: string;
  @ApiPropertyOptional({ description: 'Batas akhir arsip. Tidak boleh lebih baru dari cutoff warmDays policy.' }) @IsOptional() @IsDateString() rangeEnd?: string;
  @ApiProperty({ enum: ['ARCHIVE'], description: 'Konfirmasi eksplisit operator untuk menjalankan arsip.' })
  @IsString() @IsIn(['ARCHIVE']) confirmation!: 'ARCHIVE';
}

export class UpsertExternalMappingDto {
  @ApiProperty() @IsString() @MaxLength(80) entityType!: string;
  @ApiProperty() @IsString() @MaxLength(200) internalId!: string;
  @ApiProperty() @IsString() @MaxLength(200) externalId!: string;
  @ApiPropertyOptional() @IsOptional() @Allow() metadata?: unknown;
}

export class CloseFiscalPeriodDto {
  @ApiPropertyOptional({ description: 'Alasan operator untuk final close. Tercatat bersama audit CLOSE_FISCAL_PERIOD.' })
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
