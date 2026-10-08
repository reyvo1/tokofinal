import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

export class CreatePayrollPeriodDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsInt() @Min(2000) year!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty() @IsDateString() startDate!: string;
  @ApiProperty() @IsDateString() endDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() attendanceCutoffAt?: string;
}

export class CreatePayrollRunDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsUUID() payrollPeriodId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() taxRuleSetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() socialSecurityRuleSetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreatePayrollAdjustmentRunDto {
  @ApiProperty({ description: 'Alasan koreksi yang dapat diaudit; adjustment selalu mereferensikan payroll POSTED/PAID.' }) @IsString() @MinLength(5) reason!: string;
  @ApiPropertyOptional({ description: 'Tanggal posting jurnal adjustment; default waktu pembuatan bila tidak diisi.' }) @IsOptional() @IsDateString() postingDate?: string;
  @ApiPropertyOptional({ description: 'Opsional: rule pajak APPROVED yang menggantikan rule sumber bila koreksi memang memerlukannya.' }) @IsOptional() @IsUUID() taxRuleSetId?: string;
  @ApiPropertyOptional({ description: 'Opsional: rule social-security APPROVED yang menggantikan rule sumber bila koreksi memang memerlukannya.' }) @IsOptional() @IsUUID() socialSecurityRuleSetId?: string;
}

export class CancelPayrollRunDto {
  @ApiProperty({ description: 'Alasan pembatalan run sebelum posting; disimpan pada audit log.' }) @IsString() @MinLength(5) reason!: string;
}

export class CreatePayrollComponentDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() componentType!: string;
  @ApiProperty() @IsString() calculationType!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() defaultAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() formula?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() taxable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() affectsGross?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() affectsNet?: boolean;
  @ApiPropertyOptional({ description: 'Prorata otomatis bila assignment hanya aktif pada sebagian periode payroll.' }) @IsOptional() @IsBoolean() proratable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() attendanceBased?: boolean;
}

export class AssignEmployeeComponentDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsUUID() componentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() percentage?: number;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() formulaInputs?: Record<string, unknown>;
}

export class CreateRuleSetDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiProperty() @IsString() calculationMode!: string;
  @ApiProperty() @IsObject() parameters!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() legalReference?: string;
}

export class CreateSocialSecurityRuleSetDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiProperty() @IsObject() parameters!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() legalReference?: string;
}

export class SettlePayrollPaymentDto {
  @ApiProperty({ example: '1102', description: 'Akun aset sumber pembayaran, mis. Bank/Kas.' }) @IsString() settlementAccountCode!: string;
  @ApiProperty({ example: 'BANK_TRANSFER' }) @IsString() paymentMethod!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() externalReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() paidAt?: string;
}

export class PublishPayslipsDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() channels?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() baseUrl?: string;
}


export class UpsertEmployeeTaxProfileDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxStatusCode?: string;
  @ApiProperty({ example: 'GROSS', enum: ['GROSS', 'GROSS_UP', 'NET'], description: 'Metode pajak payroll executable: GROSS, GROSS_UP, atau NET.' }) @IsString() @IsIn(['GROSS', 'GROSS_UP', 'NET']) taxMethod!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() annualizationMethod?: string;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class UpsertEmployeeSocialSecurityProfileDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) wageBase?: number;
  @ApiProperty({ type: [String] }) @IsArray() programs!: string[];
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
}

export class UpsertPayrollAccountingMappingDto {
  @ApiProperty() @IsString() componentCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() debitAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() creditAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employerDebitAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employerCreditAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() rules?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
