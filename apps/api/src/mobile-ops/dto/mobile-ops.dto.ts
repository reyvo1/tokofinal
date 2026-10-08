import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class BindMobileIdentityDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) platformUserId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) platformChatId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) displayName?: string;
}

export class RevokeMobileIdentityDto {
  @ApiProperty() @IsUUID() bindingId!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(400) reason!: string;
}

export class ListMobileBindingsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() limit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

export class ListMobileDraftsQueryDto extends ListMobileBindingsQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'SUBMITTED', 'POSTED', 'DISCARDED'] })
  @IsOptional() @IsIn(['OPEN', 'SUBMITTED', 'POSTED', 'DISCARDED']) status?: 'OPEN' | 'SUBMITTED' | 'POSTED' | 'DISCARDED';
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}

export class OpenMobileDraftDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) deviceId!: string;
  @ApiProperty() @IsUUID() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() opnameId?: string;
}

export class AddMobileScanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) barcode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) sku?: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) note?: string;
}

export class SubmitMobileDraftDto {
  @ApiProperty() @IsUUID() opnameId!: string;
}

export class DiscardMobileDraftDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(400) reason!: string;
}
