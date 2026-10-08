import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateDigitalServiceTransactionDto {
  @ApiProperty() @IsString() providerSku!: string;
  @ApiProperty() @IsString() @MinLength(3) customerNo!: string;
  @ApiProperty() @IsString() @MinLength(8) idempotencyKey!: string;
  @ApiPropertyOptional({ description: 'Batas harga beli untuk proteksi perubahan harga provider.' }) @IsOptional() @IsNumber() @Min(0) maxPrice?: number;
}
