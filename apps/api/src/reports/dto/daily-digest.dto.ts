import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SaveDailyDigestConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 23 }) @IsOptional() @IsInt() @Min(0) @Max(23) hour?: number;
  @ApiPropertyOptional({ type: [String], maxItems: 10 }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID(undefined, { each: true }) recipientBindingIds?: string[];
}
