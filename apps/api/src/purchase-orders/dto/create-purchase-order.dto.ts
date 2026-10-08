import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
class PurchaseOrderItemDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiPropertyOptional({ description: 'Variant produk yang dipilih. Jika productUnitId terikat variant, server memvalidasi kecocokannya.' }) @IsOptional() @IsString() variantId?: string;
  @ApiPropertyOptional({ description: 'ProductUnit authoritative. Tanpa nilai ini orderedQty dianggap base unit.' }) @IsOptional() @IsString() productUnitId?: string;
  @ApiProperty({ example: 10, description: 'Jumlah dalam unit pembelian yang dipilih. Server mengonversi ke base unit untuk stok.' }) @IsInt() @Min(1) orderedQty!: number;
  @ApiProperty({ example: 10000, description: 'Harga per unit pembelian yang dipilih.' }) @IsNumber() @Min(0) unitCost!: number;
}
export class CreatePurchaseOrderDto {
  @ApiPropertyOptional({ description: 'Kunci idempotensi untuk retry aman.' }) @IsOptional() @IsString() idempotencyKey?: string;
  @ApiProperty() @IsString() supplierId!: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [PurchaseOrderItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto) items!: PurchaseOrderItemDto[];
}
