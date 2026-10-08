import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class OrderItemDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty({ example: 1, description: 'Jumlah dalam unit transaksi yang dipilih. Tanpa productUnitId/barcodeCode berarti base unit produk.' }) @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional({ description: 'ProductUnit authoritative untuk UOM/kemasan storefront.' }) @IsOptional() @IsString() productUnitId?: string;
  @ApiPropertyOptional({ description: 'Variant produk bila unit/kemasan terikat variant.' }) @IsOptional() @IsString() variantId?: string;
  @ApiPropertyOptional({ description: 'Barcode hanya shortcut ke ProductUnit/variant yang sama; snapshot transaksi tetap disimpan.' }) @IsOptional() @IsString() barcodeCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Operation key stabil untuk retry aman; alternatifnya kirim header Idempotency-Key.' }) @IsOptional() @IsString() @MaxLength(200) idempotencyKey?: string;
  @ApiProperty({ example: 'PUSAT' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  branchCode!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string;
  @ApiPropertyOptional({ description: 'Kode voucher/promo storefront yang divalidasi server.' }) @IsOptional() @IsString() @MaxLength(40) promoCode?: string;
  @ApiProperty() @IsString() customerName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() customerEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional({ default: 'DELIVERY', enum: ['DELIVERY','PICKUP'] }) @IsOptional() @IsString() @IsIn(['DELIVERY','PICKUP']) fulfillmentType?: 'DELIVERY' | 'PICKUP';
  @ApiPropertyOptional() @IsOptional() @IsString() customerAddressId?: string;
  @ApiPropertyOptional({ description: 'Kode COURIER dari master reference yang divalidasi server.' }) @IsOptional() @IsString() @MaxLength(60) shippingMethodCode?: string;
  @ApiProperty({ type: [OrderItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto) items!: OrderItemDto[];
}

export class PayOrderDto {
  @ApiPropertyOptional({ default: 'MOCK_QRIS', enum: ['MOCK_QRIS','QRIS','TRANSFER','CARD','COD','INVOICE'] })
  @IsOptional() @IsString() @IsIn(['MOCK_QRIS','QRIS','TRANSFER','CARD','COD','INVOICE']) paymentMethod?: string;
}

export class DispatchOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() carrier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() service?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() trackingNumber?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() ownFleet?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() gatePassId?: string;
}

export class ConfirmOrderPaymentDto {
  @ApiPropertyOptional({ enum: ['QRIS','TRANSFER','CARD'] })
  @IsOptional() @IsString() @IsIn(['QRIS','TRANSFER','CARD']) paymentMethod?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() provider?: string;
  @ApiProperty() @IsString() @IsNotEmpty() externalRef!: string;
}

export class CancelOrderDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
