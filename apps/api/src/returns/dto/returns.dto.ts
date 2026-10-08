import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class SaleReturnItemDto {
  @ApiProperty() @IsString() saleItemId!: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional({ default: 'GOOD' }) @IsOptional() @IsString() condition?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() restock?: boolean;
}
export class CreateSaleReturnDto {
  @ApiProperty() @IsString() saleId!: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional({ default: 'ORIGINAL', description: 'ORIGINAL memakai snapshot tender transaksi; atau kode PAYMENT_METHOD aktif yang diizinkan untuk refund.' }) @IsOptional() @IsString() @MaxLength(60) refundMethod?: string;
  @ApiProperty({ type: [SaleReturnItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => SaleReturnItemDto) items!: SaleReturnItemDto[];
}

class PurchaseReturnItemDto {
  @ApiProperty() @IsString() goodsReceiptItemId!: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
export class CreatePurchaseReturnDto {
  @ApiProperty() @IsString() goodsReceiptId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() idempotencyKey?: string;
  @ApiPropertyOptional({ description: 'Nomor credit note supplier jika retur menyentuh barang yang sudah dibayar.' }) @IsOptional() @IsString() @MaxLength(120) supplierCreditNoteNumber?: string;
  @ApiProperty({ type: [PurchaseReturnItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => PurchaseReturnItemDto) items!: PurchaseReturnItemDto[];
}

export class ConfirmReturnDto {
  @ApiPropertyOptional() @IsOptional() @IsString() inspectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() confirmationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gatePassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Dapat diisi saat konfirmasi bila credit note belum tersedia saat retur dibuat.' }) @IsOptional() @IsString() @MaxLength(120) supplierCreditNoteNumber?: string;
}
