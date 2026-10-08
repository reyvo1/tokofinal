import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class PaymentProviderCallbackDto {
  @ApiProperty() @IsString() @MaxLength(160) eventId!: string;
  @ApiPropertyOptional({ description: 'Nomor order Toko360. Salah satu orderNumber/paymentNumber wajib ada.' }) @IsOptional() @IsString() @MaxLength(100) orderNumber?: string;
  @ApiPropertyOptional({ description: 'Nomor payment Toko360.' }) @IsOptional() @IsString() @MaxLength(100) paymentNumber?: string;
  @ApiProperty() @IsString() @MaxLength(180) externalRef!: string;
  @ApiProperty({ enum: ['PAID','FAILED','CANCELLED'] }) @IsIn(['PAID','FAILED','CANCELLED']) status!: 'PAID'|'FAILED'|'CANCELLED';
  @ApiProperty({ example: '125000.00', description: 'Decimal string; jangan kirim floating point.' })
  @IsString() @Matches(/^\d{1,15}(?:\.\d{1,2})?$/) amount!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) eventType?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
