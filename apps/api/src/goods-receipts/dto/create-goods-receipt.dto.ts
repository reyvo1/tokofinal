import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
class GoodsReceiptItemDto {
  @ApiProperty() @IsString() purchaseOrderItemId!: string;
  @ApiProperty({ description: 'Total barang yang datang, termasuk barang rusak.', example: 98 }) @IsInt() @Min(1) quantityReceived!: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) quantityDamaged?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() batchNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiryDate?: string;
  @ApiPropertyOptional({ type: [String], description: 'Wajib tepat sebanyak acceptedQty untuk produk dengan trackSerial.' }) @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) serialNumbers?: string[];
  @ApiPropertyOptional({ description: 'Override tax code produk untuk penerimaan ini.' }) @IsOptional() @IsString() taxCodeId?: string;
}
export class CreateGoodsReceiptDto {
  @ApiPropertyOptional({ description: 'Kunci idempotensi untuk retry penerimaan yang aman.' }) @IsOptional() @IsString() idempotencyKey?: string;
  @ApiProperty() @IsString() purchaseOrderId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierInvoice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Hanya berlaku bila policy cabang mengizinkan auto confirm.', default: false }) @IsOptional() @IsBoolean() autoConfirm?: boolean;
  @ApiProperty({ type: [GoodsReceiptItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => GoodsReceiptItemDto) items!: GoodsReceiptItemDto[];
}
export class ConfirmGoodsReceiptDto {
  @ApiPropertyOptional() @IsOptional() @IsString() inspectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
