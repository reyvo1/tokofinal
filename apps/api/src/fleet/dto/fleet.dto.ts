import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class CreateVehicleDriverAssignmentDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() vehicleId!: string;
  @ApiProperty() @IsString() employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isPrimary?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class EndVehicleDriverAssignmentDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateVehicleDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assetId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() plateNumber!: string;
  @ApiProperty() @IsString() vehicleType!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) capacityWeight?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) capacityVolume?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) currentOdometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() fuelType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultDriverEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gpsDeviceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

class DeliveryStopInputDto {
  @ApiProperty() @IsInt() @Min(1) sequence!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() shipmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() saleId?: string;
  @ApiProperty() @IsString() customerName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;
  @ApiProperty() @IsString() address!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) codExpected?: number;
}
class ManifestItemInputDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) stopSequence?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() shipmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orderId?: string;
  @ApiProperty() @IsString() productId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() batchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialId?: string;
  @ApiProperty() @IsInt() @Min(1) expectedQty!: number;
}
export class CreateDeliveryTripDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() vehicleId!: string;
  @ApiProperty() @IsString() driverEmployeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() originWarehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() plannedDepartureAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() plannedReturnAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) startOdometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) totalWeight?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) totalVolume?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() routePlan?: Record<string, unknown>;
  @ApiProperty({ type: [DeliveryStopInputDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => DeliveryStopInputDto) stops!: DeliveryStopInputDto[];
  @ApiProperty({ type: [ManifestItemInputDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => ManifestItemInputDto) manifestItems!: ManifestItemInputDto[];
}

class LoadingScanDto {
  @ApiProperty() @IsString() manifestItemId!: string;
  @ApiProperty() @IsInt() @Min(0) scannedQty!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) damagedQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
export class ConfirmLoadingDto {
  @ApiProperty() @IsString() inspectionId!: string;
  @ApiProperty({ type: [LoadingScanDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => LoadingScanDto) scans!: LoadingScanDto[];
}

export class DispatchTripDto {
  @ApiProperty() @IsString() preTripInspectionId!: string;
  @ApiProperty() @IsString() gatePassId!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) startOdometer?: number;
}

export class CompleteStopDto {
  @ApiProperty({ enum: ['DELIVERED','PARTIAL','FAILED','RETURNED'] }) @IsString() status!: 'DELIVERED'|'PARTIAL'|'FAILED'|'RETURNED';
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) codCollected?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() proofInspectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() failureReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CloseTripDto {
  @ApiProperty() @IsString() postTripInspectionId!: string;
  @ApiProperty() @IsInt() @Min(0) endOdometer!: number;
}

export class RecordFuelDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() vehicleId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tripId?: string;
  @ApiProperty() @IsNumber() @Min(0.001) liters!: number;
  @ApiProperty() @IsNumber() @Min(0) unitPrice!: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() transactionDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) odometer?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() receiptNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
  @ApiPropertyOptional({ default: 'CASH' }) @IsOptional() @IsString() paymentMode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() evidenceReference?: string;
}
