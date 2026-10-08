import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class StockTransferItemDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() batchNumber?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) serialNumbers?: string[];
}

export class CreateStockTransferDto {
  @ApiProperty() @IsString() sourceWarehouseId!: string;
  @ApiProperty() @IsString() destinationWarehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [StockTransferItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => StockTransferItemDto) items!: StockTransferItemDto[];
}

export class ReceiveStockTransferItemDto {
  @ApiProperty() @IsString() transferItemId!: string;
  @ApiProperty() @IsInt() @Min(0) receivedQty!: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) serialNumbers?: string[];
}

export class ReceiveStockTransferDto {
  @ApiProperty({ type: [ReceiveStockTransferItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiveStockTransferItemDto) items!: ReceiveStockTransferItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateStockOpnameDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CountStockOpnameItemDto {
  @ApiProperty() @IsString() opnameItemId!: string;
  @ApiProperty() @IsInt() @Min(0) countedQty!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class CountStockOpnameDto {
  @ApiProperty({ type: [CountStockOpnameItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => CountStockOpnameItemDto) items!: CountStockOpnameItemDto[];
}
export class RelocateInventoryDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsString() sourceLocationId!: string;
  @ApiProperty() @IsString() destinationLocationId!: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}


export class MoveInventoryConditionDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty() @IsString() locationId!: string;
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty({ enum: ['AVAILABLE','DAMAGED','QUARANTINE','LOST'] }) @IsIn(['AVAILABLE','DAMAGED','QUARANTINE','LOST']) fromCondition!: 'AVAILABLE'|'DAMAGED'|'QUARANTINE'|'LOST';
  @ApiProperty({ enum: ['AVAILABLE','DAMAGED','QUARANTINE','LOST'] }) @IsIn(['AVAILABLE','DAMAGED','QUARANTINE','LOST']) toCondition!: 'AVAILABLE'|'DAMAGED'|'QUARANTINE'|'LOST';
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
