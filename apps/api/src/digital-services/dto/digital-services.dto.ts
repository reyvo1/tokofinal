import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateDigitalServiceTransactionDto {
  @ApiProperty({ enum: ['CASH'], description: 'PPOB hanya menerima uang tunai di shift aktif setelah jurnal uang muka berhasil.' }) @IsString() @IsIn(['CASH']) paymentMethod!: 'CASH';
  @ApiProperty() @IsString() providerSku!: string;
  @ApiProperty() @IsString() @MinLength(3) customerNo!: string;
  @ApiProperty() @IsString() @MinLength(8) idempotencyKey!: string;
  @ApiProperty({ description: 'Batas maksimum harga provider yang dikonfirmasi kasir; diperlukan sebelum penarikan uang.' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) maxPrice!: number;
}

export class VerifyDigitalServiceTaxDto {
  @ApiProperty({ enum: ['NO_TAX_VERIFIED'], description: 'Hanya klasifikasi bebas pajak yang telah diverifikasi petugas Finance.' })
  @IsString() @IsIn(['NO_TAX_VERIFIED']) taxTreatment!: 'NO_TAX_VERIFIED';
  @ApiProperty({ description: 'Alasan terperinci keputusan perlakuan pajak oleh Finance.' })
  @IsString() @MinLength(12) @MaxLength(500) reason!: string;
}
