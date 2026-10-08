import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) permissionCodes?: string[];
}
export class SetRolePermissionsDto {
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) permissionCodes!: string[];
}
export class SetUserRolesDto {
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) roleNames!: string[];
}
export class SetUserStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}
