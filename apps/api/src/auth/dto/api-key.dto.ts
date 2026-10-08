import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ type: [String], example: ['product.view','inventory.view'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) scopes!: string[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  // POST-1D. Pins the key to one branch. Optional on purpose: leaving it out keeps today's
  // company-wide, header-selected behaviour for every existing integration.
  @ApiPropertyOptional({ description: 'Pin key ini ke satu cabang (kiosk/ perangkat depan pelanggan).' })
  @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @ApiPropertyOptional({ description: 'Lokasi fisik perangkat, mis. "kasir 2". Hanya untuk kebutuhan operator.' })
  @IsOptional() @IsString() @MaxLength(80) locationLabel?: string;
}
