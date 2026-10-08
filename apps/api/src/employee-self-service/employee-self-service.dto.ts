import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, IsUUID, Length, MinLength } from 'class-validator';

export enum EmployeeChannelDto { IN_APP = 'IN_APP', EMAIL = 'EMAIL', TELEGRAM = 'TELEGRAM', WHATSAPP = 'WHATSAPP', SMS = 'SMS' }
export class RequestChannelBindingDto {
  @ApiProperty({ enum: EmployeeChannelDto }) @IsEnum(EmployeeChannelDto) channel!: EmployeeChannelDto;
  @ApiProperty({ description: 'Telegram chat ID, nomor WhatsApp E.164, email, atau external user ID provider.' }) @IsString() externalUserId!: string;
}
export class VerifyChannelBindingDto {
  @ApiProperty({ enum: EmployeeChannelDto }) @IsEnum(EmployeeChannelDto) channel!: EmployeeChannelDto;
  @ApiProperty() @IsString() externalUserId!: string;
  @ApiProperty() @IsString() @Length(6, 6) code!: string;
}
export class UpdateNotificationPreferenceDto {
  @ApiProperty() @IsString() eventCode!: string;
  @ApiProperty({ enum: EmployeeChannelDto }) @IsEnum(EmployeeChannelDto) channel!: EmployeeChannelDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}


export class SubmitAttendanceCorrectionDto {
  @ApiProperty() @IsUUID() attendanceRecordId!: string;
  @ApiProperty() @IsString() @MinLength(5) reason!: string;
  @ApiProperty() @IsObject() proposedData!: Record<string, unknown>;
}
