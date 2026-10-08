import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RegisterStorefrontCustomerDto {
  @ApiProperty({ example: 'PUSAT' }) @IsString() @MaxLength(100) branchCode!: string;
  @ApiProperty() @IsString() @MaxLength(160) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(128) password!: string;
}

export class LoginStorefrontCustomerDto {
  @ApiProperty({ example: 'PUSAT' }) @IsString() @MaxLength(100) branchCode!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MaxLength(128) password!: string;
}

export class UpdateStorefrontProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
}

export class CreateProductReviewDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsString() @MaxLength(36) orderId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) body?: string;
}

export class RequestCustomerVerificationDto {
  @ApiProperty({ enum: ['EMAIL','PHONE'] }) @IsString() @IsIn(['EMAIL','PHONE']) type!: 'EMAIL' | 'PHONE';
}

export class ConfirmCustomerVerificationDto extends RequestCustomerVerificationDto {
  @ApiProperty({ example: '12345678' }) @IsString() @MinLength(8) @MaxLength(8) code!: string;
}
export class CreateCustomerAddressDto {
  @ApiProperty({ example: 'Rumah' }) @IsString() @MaxLength(60) label!: string;
  @ApiProperty() @IsString() @MaxLength(160) recipientName!: string;
  @ApiProperty() @IsString() @MaxLength(40) phone!: string;
  @ApiProperty() @IsString() @MaxLength(500) addressLine!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) district?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) province?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateCustomerAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) recipientName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) addressLine?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) district?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) province?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

