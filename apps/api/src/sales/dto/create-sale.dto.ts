import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
class SaleItemDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty({ example: 1, description: 'Jumlah unit jual. Tanpa productUnitId/barcodeCode berarti base unit produk.' }) @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional({ description: 'Variant produk. Server memvalidasi terhadap ProductUnit/barcode yang dipilih.' }) @IsOptional() @IsString() variantId?: string;
  @ApiPropertyOptional({ description: 'ProductUnit authoritative untuk pemilihan UOM langsung dari POS/UI.' }) @IsOptional() @IsString() productUnitId?: string;
  @ApiPropertyOptional({ description: 'Barcode unit/kemasan yang discan. Barcode hanya shortcut ke ProductUnit/unit snapshot authoritative.' }) @IsOptional() @IsString() @MaxLength(160) barcodeCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCodeId?: string;
}

export class SalePaymentDto {
  @ApiProperty({ description: 'Kode PAYMENT_METHOD aktif dari master data.' }) @IsString() @MaxLength(60) method!: string;
  @ApiProperty({ example: 50000 }) @IsNumber() @Min(0.01) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) provider?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) externalRef?: string;
}
export class CreateSaleDto {
  @ApiPropertyOptional({ description: 'Kunci idempotensi untuk retry aman.' }) @IsOptional() @IsString() idempotencyKey?: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cashierShiftId?: string;
  @ApiPropertyOptional({ default: 'CASH', description: 'Kompatibilitas transaksi satu metode. Nilai adalah kode PAYMENT_METHOD aktif; jangan kirim bersamaan dengan payments.' }) @IsOptional() @IsString() @MaxLength(60) paymentMethod?: string;
  @ApiPropertyOptional({ type: [SalePaymentDto], description: 'Split/partial tender. Pembayaran + onAccountAmount wajib sama persis dengan total transaksi.' }) @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => SalePaymentDto) payments?: SalePaymentDto[];
  @ApiPropertyOptional({ description: 'Bagian transaksi yang menjadi piutang pelanggan (AR). Customer wajib dipilih dan nilai ini eksplisit; tidak pernah dihasilkan diam-diam.' }) @IsOptional() @IsNumber() @Min(0.01) onAccountAmount?: number;
  @ApiPropertyOptional({ default: false, description: 'Menegaskan bahwa transaksi sengaja memiliki saldo piutang. Wajib true bila onAccountAmount dikirim.' }) @IsOptional() @IsBoolean() onAccount?: boolean;
  @ApiPropertyOptional({ description: 'Kode promo aktif yang diterapkan server.' }) @IsOptional() @IsString() @MaxLength(64) promoCode?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) discount?: number;
  @ApiPropertyOptional({ description: 'Grant persetujuan supervisor; wajib bila diskon manual di atas 20% dari subtotal.' }) @IsOptional() @IsString() @MaxLength(160) supervisorApprovalId?: string;
  @ApiPropertyOptional({ default: 0, description: 'Biaya layanan (kartu/QRIS/antar), dipisah dari revenue produk.' }) @IsOptional() @IsNumber() @Min(0) serviceFee?: number;
  @ApiPropertyOptional({ description: 'Tukar poin loyalitas; diskon = points / redemptionRate program.' }) @IsOptional() @IsInt() @Min(0) redeemPoints?: number;
  @ApiProperty({ type: [SaleItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => SaleItemDto) items!: SaleItemDto[];
}

export class OpenCashierShiftDto {
  @ApiProperty({ example: 500000 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) openingCash!: number;
}

export class CloseCashierShiftDto {
  @ApiProperty({ example: 1750000 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) closingCash!: number;
  @ApiPropertyOptional({ description: 'Grant persetujuan supervisor; wajib bila selisih kas melebihi toleransi.' })
  @IsOptional() @IsString() @MaxLength(160) supervisorApprovalId?: string;
}

export class CashierCashMovementDto {
  @ApiProperty({ description: 'Kunci unik per niat mutasi kas. Retry dengan key sama harus mengembalikan movement awal.' })
  @IsString() @MinLength(8) @MaxLength(160) idempotencyKey!: string;
  @ApiProperty({ enum: ['CASH_IN','CASH_OUT'] }) @IsString() @IsIn(['CASH_IN','CASH_OUT']) type!: 'CASH_IN' | 'CASH_OUT';
  @ApiProperty({ example: 100000, description: 'Nominal positif dengan maksimal 2 angka di belakang desimal.' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @ApiProperty({ example: 'Tambah uang kecil' }) @IsString() @MaxLength(240) reason!: string;
  @ApiPropertyOptional({ description: 'Grant persetujuan supervisor; wajib bila pengambilan kas melebihi 5% dari isi laci.' })
  @IsOptional() @IsString() @MaxLength(160) supervisorApprovalId?: string;
}

export class OfflineSaleReplayItemDto {
  @ApiProperty() @IsString() @MaxLength(160) localId!: string;
  @ApiProperty() @IsInt() @Min(1) sequence!: number;
  @ApiProperty() @IsDateString() capturedAt!: string;
  @ApiProperty({ description: 'Waktu terakhir POS menerima konfigurasi harga/pajak server.' }) @IsDateString() configSyncedAt!: string;
  @ApiProperty({ description: 'Total yang diterima kasir saat offline; server harus cocok sebelum transaksi diterapkan.' }) @IsNumber() @Min(0) expectedTotal!: number;
  @ApiProperty({ type: CreateSaleDto }) @ValidateNested() @Type(() => CreateSaleDto) payload!: CreateSaleDto;
}

export class ReplayOfflineSalesDto {
  @ApiProperty() @IsString() @MaxLength(160) deviceCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) deviceName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) appVersion?: string;
  @ApiProperty({ type: [OfflineSaleReplayItemDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OfflineSaleReplayItemDto) transactions!: OfflineSaleReplayItemDto[];
}
