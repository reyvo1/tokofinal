import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

const PROMO_TYPES = ['PERCENT', 'AMOUNT', 'QUANTITY_BREAK', 'BOGO', 'BUNDLE'] as const;
const PROMO_CHANNELS = ['ALL', 'POS', 'STOREFRONT'] as const;

export class CreatePromoRuleDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(80) name!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(40) code!: string;
  @ApiProperty({ enum: PROMO_TYPES }) @IsIn(PROMO_TYPES) type!: typeof PROMO_TYPES[number];
  @ApiProperty({ description: 'PERCENT/QUANTITY_BREAK: persen. AMOUNT/BUNDLE: nominal. BOGO: boleh 0.' }) @IsNumber() @Min(0) value!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minSubtotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxDiscount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) memberTier?: string;
  @ApiPropertyOptional({ enum: PROMO_CHANNELS, default: 'ALL' }) @IsOptional() @IsIn(PROMO_CHANNELS) channel?: typeof PROMO_CHANNELS[number];
  @ApiPropertyOptional({ type: [String], description: 'Kosong berarti semua produk.' }) @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
  @ApiPropertyOptional({ description: 'QUANTITY_BREAK/BUNDLE: minimum unit eligible.' }) @IsOptional() @IsInt() @Min(1) minQuantity?: number;
  @ApiPropertyOptional({ description: 'BOGO: jumlah unit yang dibeli.' }) @IsOptional() @IsInt() @Min(1) buyQuantity?: number;
  @ApiPropertyOptional({ description: 'BOGO: jumlah unit gratis.' }) @IsOptional() @IsInt() @Min(1) getQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
}

export class UpdatePromoRuleDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(80) name?: string;
  @IsOptional() @IsIn(PROMO_TYPES) type?: typeof PROMO_TYPES[number];
  @IsOptional() @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsNumber() @Min(0) minSubtotal?: number;
  @IsOptional() @IsNumber() @Min(0) maxDiscount?: number;
  @IsOptional() @IsString() @MaxLength(40) memberTier?: string;
  @IsOptional() @IsIn(PROMO_CHANNELS) channel?: typeof PROMO_CHANNELS[number];
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
  @IsOptional() @IsInt() @Min(1) minQuantity?: number;
  @IsOptional() @IsInt() @Min(1) buyQuantity?: number;
  @IsOptional() @IsInt() @Min(1) getQuantity?: number;
  @IsOptional() @IsInt() @Min(1) usageLimit?: number;
  @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
