import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ConfirmTwoFactorSetupDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  code!: string;
}

export class DisableTwoFactorDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ description: 'Current TOTP or one unused recovery code.' })
  @IsString()
  @MinLength(6)
  code!: string;
}

export class RegenerateRecoveryCodesDto {
  @ApiProperty({ description: 'Current TOTP or one unused recovery code.' })
  @IsString()
  @MinLength(6)
  code!: string;
}
