import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Min } from 'class-validator';
export class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-001' }) @IsString() code!: string;
  @ApiProperty({ example: 'PT Sumber Makmur' }) @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) paymentTermDays?: number;
}


export class UpdateSupplierDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) paymentTermDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
