import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkProductRowDto {
  @ApiProperty() @IsString() sku!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() barcode?: string;
  @ApiProperty() @IsString() unit!: string;
  @ApiProperty() @IsNumber() @Min(0) costPrice!: number;
  @ApiProperty() @IsNumber() @Min(0) salePrice!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) retailCeilingPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() brandCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categorySlug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() productType?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackBatch?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackExpiry?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackSerial?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BulkImportProductsDto {
  @ApiProperty({ type: [BulkProductRowDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => BulkProductRowDto) rows!: BulkProductRowDto[];
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() dryRun?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() updateExisting?: boolean;
}
