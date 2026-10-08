import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Min, MinLength } from 'class-validator';

export class UpdateTenantProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) name?: string;
  @ApiPropertyOptional({ example: 'Asia/Makassar' }) @IsOptional() @IsString() @MinLength(3) timezone?: string;
  @ApiPropertyOptional({ example: 'IDR' }) @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
}

export class UpsertFeatureFlagDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Opsional untuk konfigurasi branch token; branch lain ditolak.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiPropertyOptional() @IsOptional() @Allow() config?: unknown;
}

export class UpsertSettingDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Opsional untuk konfigurasi branch token; branch lain ditolak.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() namespace!: string;
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @Allow() value!: unknown;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isSecret?: boolean;
}

export class CreateCustomFieldDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() entityType!: string;
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsString() label!: string;
  @ApiProperty({ enum: ['string','text','number','decimal','boolean','date','datetime','select','multiselect','json'] })
  @IsIn(['string','text','number','decimal','boolean','date','datetime','select','multiselect','json']) dataType!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() searchable?: boolean;
  @ApiPropertyOptional() @IsOptional() @Allow() defaultValue?: unknown;
  @ApiPropertyOptional() @IsOptional() @Allow() options?: unknown;
  @ApiPropertyOptional() @IsOptional() @Allow() validation?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class SetCustomFieldValueDto {
  @ApiProperty() @IsString() definitionId!: string;
  @ApiProperty() @IsString() entityType!: string;
  @ApiProperty() @IsString() entityId!: string;
  @ApiProperty() @Allow() value!: unknown;
}

export class CreateIntegrationDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Opsional untuk integrasi branch token; branch lain ditolak.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ enum: ['PAYMENT','SHIPPING','MARKETPLACE','NOTIFICATION','ACCOUNTING','STORAGE','ANALYTICS','IDENTITY','DEVICE','PPOB','CUSTOM'] })
  @IsIn(['PAYMENT','SHIPPING','MARKETPLACE','NOTIFICATION','ACCOUNTING','STORAGE','ANALYTICS','IDENTITY','DEVICE','PPOB','CUSTOM']) type!: string;
  @ApiProperty() @IsString() provider!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @Allow() config?: unknown;
  @ApiPropertyOptional({ description: 'Pada produksi kirim secret ke secret manager, bukan plaintext.' }) @IsOptional() @IsString() encryptedSecrets?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() capabilities?: unknown;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ enum: ['DISCONNECTED','CONNECTED','DEGRADED','DISABLED'] })
  @IsOptional() @IsIn(['DISCONNECTED','CONNECTED','DEGRADED','DISABLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() config?: unknown;
  @ApiPropertyOptional({ description: 'Secret baru plaintext; server mengenkripsinya. Nilai kosong tidak menghapus secret lama.' })
  @IsOptional() @IsString() encryptedSecrets?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() capabilities?: unknown;
}

export class CreateWebhookDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsUrl({ require_tld: false }) url!: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) events!: string[];
  @ApiPropertyOptional() @IsOptional() @Allow() headers?: unknown;
}

export class CreateBusinessRuleDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() trigger!: string;
  @ApiPropertyOptional() @IsOptional() @Allow() conditions?: unknown;
  @ApiProperty() @Allow() actions!: unknown;
  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
}


export class UpdateBusinessRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() trigger?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() conditions?: unknown;
  @ApiPropertyOptional() @IsOptional() @Allow() actions?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateApprovalPolicyDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() entityType!: string;
  @ApiPropertyOptional() @IsOptional() @Allow() conditions?: unknown;
  @ApiProperty({ description: 'Array langkah approval dalam JSON.' }) @Allow() steps!: unknown;
}

export class CreateApprovalRequestDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() policyId?: string;
  @ApiProperty() @IsString() entityType!: string;
  @ApiProperty() @IsString() entityId!: string;
  @ApiPropertyOptional() @IsOptional() amount?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() context?: unknown;
}


export class DelegateApprovalDto {
  @ApiProperty() @IsString() targetUserId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class DecideApprovalDto {
  @ApiProperty({ enum: ['APPROVED','REJECTED'] }) @IsIn(['APPROVED','REJECTED']) status!: 'APPROVED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateUiSchemaDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Opsional untuk schema branch token; branch lain ditolak.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() surface!: string;
  @ApiProperty() @IsObject() schema!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) version?: number;
}
