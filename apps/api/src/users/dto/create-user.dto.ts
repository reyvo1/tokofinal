import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' })
  @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ type: [String], example: ['CASHIER'] }) @IsArray() @IsString({ each: true }) roleNames!: string[];
}
