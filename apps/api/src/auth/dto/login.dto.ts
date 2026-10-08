import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@toko360.local' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin123!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ required: false, description: 'TOTP 6 digit atau recovery code ketika 2FA aktif.' })
  @IsOptional()
  @IsString()
  twoFactorCode?: string;
}

