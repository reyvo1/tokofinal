import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh token returned by login/refresh. The server stores only its SHA-256 hash.' })
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}
