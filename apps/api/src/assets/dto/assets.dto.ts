import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

enum AssetTypeDto { MOVABLE='MOVABLE', IMMOVABLE='IMMOVABLE', VEHICLE='VEHICLE', LAND='LAND', BUILDING='BUILDING', EQUIPMENT='EQUIPMENT', FURNITURE='FURNITURE', IT='IT', SOFTWARE='SOFTWARE', OTHER='OTHER' }

export class CreateAssetCategoryDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: AssetTypeDto }) @IsEnum(AssetTypeDto) assetType!: AssetTypeDto;
  @ApiPropertyOptional({ default: 'STRAIGHT_LINE' }) @IsOptional() @IsString() depreciationMethod?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) residualValuePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() assetAccountCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accumulatedDepreciationCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() depreciationExpenseCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() maintenanceExpenseCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultInspectionTemplateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CreateAssetDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string;
  @ApiProperty() @IsString() categoryId!: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() registrationNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() acquisitionDate?: string;
  @ApiProperty({ example: 100000000 }) @IsNumber() @Min(0) acquisitionCost!: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() locationName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
  @ApiPropertyOptional({ default: 'CREDIT', enum: ['CASH','BANK','CREDIT'] }) @IsOptional() @IsString() paymentMode?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class AssignAssetDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() employeeId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() handoverInspectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() conditionAtIssue?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateMaintenanceWorkOrderDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() assetId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleId?: string;
  @ApiProperty() @IsString() maintenanceType!: string;
  @ApiPropertyOptional({ default: 'NORMAL' }) @IsOptional() @IsString() priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) estimatedCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class MaintenancePartUsageDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() batchId?: string;
  @ApiPropertyOptional({ type: [String], description: 'Wajib sejumlah quantity untuk produk serial-tracked.' }) @IsOptional() @IsArray() @IsString({ each: true }) serialIds?: string[];
}

export class CompleteMaintenanceDto {
  @ApiProperty() @IsNumber() @Min(0) actualCost!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) odometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() inspectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
  @ApiPropertyOptional({ default: 'CASH', enum: ['CASH','BANK','CREDIT'] }) @IsOptional() @IsString() paymentMode?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() completedAt?: string;
  @ApiPropertyOptional({ type: [MaintenancePartUsageDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MaintenancePartUsageDto) parts?: MaintenancePartUsageDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateAssetMaintenancePlanDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiProperty() @IsString() assetId!: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() scheduleType!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) intervalDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) intervalOdometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() nextDueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) nextDueOdometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() checklistTemplateId?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() autoCreateWorkOrder?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateAssetMaintenancePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scheduleType?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) intervalDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) intervalOdometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() nextDueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) nextDueOdometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() checklistTemplateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoCreateWorkOrder?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class RunDepreciationDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsDateString() periodStart!: string;
  @ApiProperty() @IsDateString() periodEnd!: string;
}

export class TransferAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() targetWarehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() targetEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() targetLocationName?: string;
  @ApiProperty() @IsString() inspectionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() transferredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class DisposeAssetDto {
  @ApiProperty({ enum: ['DISPOSAL','SALE'] }) @IsString() mode!: 'DISPOSAL'|'SALE';
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) proceeds?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
  @ApiPropertyOptional({ default: 'CASH', enum: ['CASH','BANK'] }) @IsOptional() @IsString() settlementMode?: string;
  @ApiProperty() @IsString() inspectionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() disposedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
