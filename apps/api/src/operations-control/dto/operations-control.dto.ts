import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

enum InspectionTypeDto {
  PURCHASE_INBOUND='PURCHASE_INBOUND', TRANSFER_INBOUND='TRANSFER_INBOUND', SALE_OUTBOUND='SALE_OUTBOUND',
  ORDER_OUTBOUND='ORDER_OUTBOUND', RETURN_INBOUND='RETURN_INBOUND', VEHICLE_PRETRIP='VEHICLE_PRETRIP',
  VEHICLE_POSTTRIP='VEHICLE_POSTTRIP', ASSET_HANDOVER='ASSET_HANDOVER', ASSET_PERIODIC='ASSET_PERIODIC',
  DELIVERY_PROOF='DELIVERY_PROOF', GATE_SECURITY='GATE_SECURITY', OTHER='OTHER'
}

enum ResultDto { PASS='PASS', FAIL='FAIL', OBSERVATION='OBSERVATION', NOT_APPLICABLE='NOT_APPLICABLE' }

export class UpsertOperationPolicyDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() operationType!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireInspection?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requirePhoto?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireBarcodeScan?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireBatchScan?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireSerialScan?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireVehicle?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireGatePass?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireGeofence?: boolean;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) requiredConfirmations?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() blockOnMismatch?: boolean;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) quantityTolerancePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoPostInventory?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoPostAccounting?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoCalculateTax?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() approvalPolicyCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() inspectionTemplateCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() workflow?: Record<string, unknown>;
}

class TemplateItemDto {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() label!: string;
  @ApiPropertyOptional({ default: 'PASS_FAIL' }) @IsOptional() @IsString() responseType?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() expectedValue?: Record<string, unknown>;
  @ApiPropertyOptional({ default: 'BLOCKING' }) @IsOptional() @IsString() failureSeverity?: string;
  @ApiProperty() @IsInt() @Min(1) sequence!: number;
}

export class CreateInspectionTemplateDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: InspectionTypeDto }) @IsEnum(InspectionTypeDto) type!: InspectionTypeDto;
  @ApiProperty() @IsString() appliesTo!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() rules?: Record<string, unknown>;
  @ApiProperty({ type: [TemplateItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateItemDto) items!: TemplateItemDto[];
}

export class CreateInspectionDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ enum: InspectionTypeDto }) @IsEnum(InspectionTypeDto) type!: InspectionTypeDto;
  @ApiProperty() @IsString() sourceType!: string;
  @ApiProperty() @IsString() sourceId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() templateCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

class InspectionResultDto {
  @ApiPropertyOptional() @IsOptional() @IsString() templateItemId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() label!: string;
  @ApiProperty({ enum: ResultDto }) @IsEnum(ResultDto) result!: ResultDto;
  @ApiPropertyOptional() @IsOptional() value?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() expectedQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() scannedQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() acceptedQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() rejectedQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() damagedQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() missingQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() extraQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

class InspectionEvidenceDto {
  @ApiProperty() @IsString() evidenceType!: string;
  @ApiProperty() @IsString() storageKey!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mimeType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sha256?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}


export class AddInspectionEvidenceDto {
  @ApiProperty({ enum: ['PHOTO','BARCODE','DOCUMENT','SIGNATURE'] })
  @IsString() @IsIn(['PHOTO','BARCODE','DOCUMENT','SIGNATURE']) evidenceType!: 'PHOTO'|'BARCODE'|'DOCUMENT'|'SIGNATURE';
  @ApiPropertyOptional({ description: 'Base64 murni untuk PHOTO/DOCUMENT/SIGNATURE. Maksimum 8 MiB setelah decode.' })
  @ValidateIf((value: AddInspectionEvidenceDto) => value.evidenceType !== 'BARCODE')
  @IsString() dataBase64?: string;
  @ApiPropertyOptional({ description: 'Nilai barcode/QR yang dipindai.' })
  @ValidateIf((value: AddInspectionEvidenceDto) => value.evidenceType === 'BARCODE')
  @IsString() @MaxLength(512) value?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) mimeType?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() capturedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CompleteInspectionDto {
  @ApiProperty({ type: [InspectionResultDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => InspectionResultDto) results!: InspectionResultDto[];
  @ApiPropertyOptional({ type: [InspectionEvidenceDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InspectionEvidenceDto) evidence?: InspectionEvidenceDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ApproveInspectionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateGatePassDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ enum: ['INBOUND','OUTBOUND'] }) @IsString() direction!: 'INBOUND'|'OUTBOUND';
  @ApiProperty() @IsString() sourceType!: string;
  @ApiProperty() @IsString() sourceId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plateNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() inspectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() documents?: Record<string, unknown>;
}

export class ConfirmOperationDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() sourceType!: string;
  @ApiProperty() @IsString() sourceId!: string;
  @ApiProperty() @IsString() confirmationType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() inspectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() decision?: Record<string, unknown>;
}
