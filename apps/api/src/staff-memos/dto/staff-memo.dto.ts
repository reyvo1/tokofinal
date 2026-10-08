import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStaffMemoDto {
  @ApiProperty({ example: 'Follow up supplier' })
  @IsString()
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ example: 'Hubungi supplier sebelum jam 15:00.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

export class UpdateStaffMemoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ description: 'true mengarsipkan, false memulihkan memo.' })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
