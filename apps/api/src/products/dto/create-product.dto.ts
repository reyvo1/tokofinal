import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'SKU-001' }) @IsString() sku!: string;
  @ApiPropertyOptional({ example: '899000000001' }) @IsOptional() @IsString() barcode?: string;
  @ApiProperty({ example: 'Produk Contoh' }) @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brandCode?: string;
  @ApiProperty({ example: 'BATANG', description: 'Base unit aktif dari master UNIT perusahaan. Gunakan unit fisik terkecil yang benar-benar distok.' }) @IsString() @MaxLength(60) unit!: string;
  @ApiPropertyOptional({ enum: ['PHYSICAL', 'SERVICE'], default: 'PHYSICAL' }) @IsOptional() @IsIn(['PHYSICAL', 'SERVICE']) productType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) taxCategoryCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() salesTaxCodeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() purchaseTaxCodeId?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() trackBatch?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Expiry wajib dicatat per batch dan batch kedaluwarsa tidak boleh dipenuhi ke penjualan.' }) @IsOptional() @IsBoolean() trackExpiry?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() trackSerial?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() allowNegativeStock?: boolean;
  @ApiProperty({ example: 10000 }) @IsNumber() @Min(0) costPrice!: number;
  @ApiProperty({ example: 15000 }) @IsNumber() @Min(0) salePrice!: number;
  @ApiPropertyOptional({ description: 'Harga Eceran Tertinggi (HET) per base unit. Harga jual/override tidak boleh melampaui nilai ini bila diisi.' }) @IsOptional() @IsNumber() @Min(0) retailCeilingPrice?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) minStock?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
