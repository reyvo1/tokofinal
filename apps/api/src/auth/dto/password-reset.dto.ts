import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'admin@toko360.local' })
  @IsEmail()
  email!: string;
}

export class ConfirmPasswordResetDto {
  @ApiProperty({ description: 'Opaque reset token received through the configured notification channel.' })
  @IsString()
  @MinLength(32)
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
