import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';


export class CreateAccountDto {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'] }) @IsIn(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']) type!: 'ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'EXPENSE';
}

export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ enum: ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'] }) @IsOptional() @IsIn(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']) type?: 'ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'EXPENSE';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePostingRuleStatusDto {
  @ApiProperty({ enum: ['DRAFT','ACTIVE','INACTIVE'] }) @IsIn(['DRAFT','ACTIVE','INACTIVE']) status!: 'DRAFT'|'ACTIVE'|'INACTIVE';
}

enum TaxScopeDto { SALE='SALE', PURCHASE='PURCHASE', EXPENSE='EXPENSE', ASSET='ASSET', PAYROLL='PAYROLL', SHIPPING='SHIPPING', WITHHOLDING='WITHHOLDING', OTHER='OTHER' }

export class CreateTaxCodeDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) version?: number;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: TaxScopeDto }) @IsEnum(TaxScopeDto) scope!: TaxScopeDto;
  @ApiProperty({ example: 0 }) @IsNumber() @Min(0) rate!: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() inclusive?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() recoverable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() payableAccountCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() receivableAccountCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() expenseAccountCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional({ default: 'DRAFT', enum: ['DRAFT','ACTIVE'] }) @IsOptional() @IsIn(['DRAFT','ACTIVE']) status?: 'DRAFT'|'ACTIVE';
  @ApiPropertyOptional() @IsOptional() @IsObject() calculationRules?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() legalReference?: string;
}

export class UpdateTaxCodeStatusDto {
  @ApiProperty({ enum: ['DRAFT','ACTIVE','INACTIVE'] }) @IsIn(['DRAFT','ACTIVE','INACTIVE']) status!: 'DRAFT'|'ACTIVE'|'INACTIVE';
}

class PostingRuleLineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() accountCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountCodeKey?: string;
  @ApiProperty({ enum: ['DEBIT','CREDIT'] }) @IsString() side!: 'DEBIT' | 'CREDIT';
  @ApiProperty() @IsString() amountKey!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() skipIfZero?: boolean;
}

export class CreatePostingRuleDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() eventType!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @IsInt() priority?: number;
  @ApiPropertyOptional({ default: 'DRAFT' }) @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() conditions?: Record<string, unknown>;
  @ApiProperty({ type: [PostingRuleLineDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => PostingRuleLineDto) journalLines!: PostingRuleLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsObject() taxBehavior?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() dimensions?: Record<string, unknown>;
}

class ManualEventLineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() itemType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() itemId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() quantity?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() unitAmount?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() netAmount?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() taxAmount?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() grossAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() dimensions?: Record<string, unknown>;
}

class ManualTaxLineDto {
  @ApiProperty() @IsString() taxCodeId!: string;
  @ApiProperty({ enum: ['INPUT','OUTPUT','WITHHOLDING','SELF_ASSESSED'] }) @IsString() direction!: 'INPUT'|'OUTPUT'|'WITHHOLDING'|'SELF_ASSESSED';
  @ApiProperty() @IsNumber() taxableBase!: number;
  @ApiProperty() @IsNumber() taxAmount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() counterpartyType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() counterpartyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() documentNumber?: string;
}

export class PostManualAccountingEventDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; tenant tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() eventType!: string;
  @ApiProperty() @IsString() sourceType!: string;
  @ApiProperty() @IsString() sourceId!: string;
  @ApiProperty() @IsString() idempotencyKey!: string;
  @ApiPropertyOptional({ default: 'IDR' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() businessDate?: string;
  @ApiProperty() @IsObject() amounts!: Record<string, number>;
  @ApiPropertyOptional() @IsOptional() @IsObject() accountCodes?: Record<string, string>;
  @ApiPropertyOptional({ type: [ManualEventLineDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ManualEventLineDto) lines?: ManualEventLineDto[];
  @ApiPropertyOptional({ type: [ManualTaxLineDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ManualTaxLineDto) taxLines?: ManualTaxLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsObject() context?: Record<string, unknown>;
}

export class PreviewTaxDto {
  @ApiProperty() @IsString() taxCodeId!: string;
  @ApiProperty() @IsNumber() amount!: number;
}


export class CreateAccountingCloseControlDto {
  @ApiPropertyOptional({ default: 'ACCOUNTING' }) @IsOptional() @IsString() module?: string;
  @ApiProperty() @IsDateString() periodStart!: string;
  @ApiProperty() @IsDateString() periodEnd!: string;
}

export class ReopenAccountingCloseControlDto {
  @ApiProperty() @IsString() reopenReason!: string;
}
