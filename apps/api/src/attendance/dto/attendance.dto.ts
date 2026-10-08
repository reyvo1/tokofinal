import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBase64, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

export enum AttendanceMethodDto {
  FINGERPRINT = 'FINGERPRINT', FACE_DEVICE = 'FACE_DEVICE', SELFIE_GPS = 'SELFIE_GPS',
  MOBILE_GPS = 'MOBILE_GPS', WEB = 'WEB', QR_CODE = 'QR_CODE', MANUAL = 'MANUAL', API_IMPORT = 'API_IMPORT',
}
export enum AttendanceEventTypeDto {
  CHECK_IN = 'CHECK_IN', CHECK_OUT = 'CHECK_OUT', BREAK_START = 'BREAK_START', BREAK_END = 'BREAK_END',
  OVERTIME_START = 'OVERTIME_START', OVERTIME_END = 'OVERTIME_END',
}

export class CreateAttendanceEventDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty({ enum: AttendanceEventTypeDto }) @IsEnum(AttendanceEventTypeDto) eventType!: AttendanceEventTypeDto;
  @ApiProperty({ enum: AttendanceMethodDto }) @IsEnum(AttendanceMethodDto) method!: AttendanceMethodDto;
  @ApiProperty() @IsDateString() occurredAt!: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD sesuai timezone cabang.' }) @IsOptional() @IsString() workDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() geofenceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() operationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() externalEventId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) accuracyMeters?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() photoObjectKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) livenessScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) faceMatchScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() sourcePayload?: Record<string, unknown>;
}

export class FingerprintEventDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() deviceCode!: string;
  @ApiProperty() @IsString() deviceUserCode!: string;
  @ApiProperty() @IsString() externalEventId!: string;
  @ApiProperty() @IsDateString() occurredAt!: string;
  @ApiProperty({ enum: AttendanceEventTypeDto }) @IsEnum(AttendanceEventTypeDto) eventType!: AttendanceEventTypeDto;
  @ApiPropertyOptional() @IsOptional() @IsObject() sourcePayload?: Record<string, unknown>;
}

export class CreateGeofenceDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ApiProperty() @IsInt() @Min(5) radiusMeters!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) allowedAccuracyMeters?: number;
}

export class CreateAttendanceDeviceDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() deviceType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ipAddress?: string;
}

export class EnrollBiometricDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() attendanceDeviceId?: string;
  @ApiProperty() @IsString() biometricType!: string;
  @ApiProperty() @IsString() deviceUserCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() externalTemplateRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() templateHash?: string;
}

export class UploadAttendancePhotoDto {
  @ApiProperty() @IsString() fileName!: string;
  @ApiProperty() @IsString() contentType!: string;
  @ApiProperty() @IsBase64() base64!: string;
}


export class CreateWorkShiftDto {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1439) endMinute!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() crossesMidnight?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) breakMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) lateToleranceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) earlyLeaveToleranceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minimumWorkMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) overtimeAfterMinutes?: number;
}

export class UpdateWorkShiftDto extends CreateWorkShiftDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpsertEmployeeScheduleDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsDateString() workDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() shiftId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDayOff?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateAttendancePolicyDto {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ type: [String], enum: AttendanceMethodDto }) @IsArray() allowedMethods!: AttendanceMethodDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requirePhoto?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireLocation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireLiveness?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOutsideGeofence?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxLocationAccuracyMeters?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) duplicateWindowSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offlineAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() rules?: Record<string, unknown>;
}

export class UpdateAttendancePolicyDto extends CreateAttendancePolicyDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateAttendanceCorrectionDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsUUID() attendanceRecordId!: string;
  @ApiProperty() @IsString() @MinLength(5) reason!: string;
  @ApiProperty() @IsObject() proposedData!: Record<string, unknown>;
}

export enum AttendanceCorrectionDecisionDto { APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
export class ReviewAttendanceCorrectionDto {
  @ApiProperty({ enum: AttendanceCorrectionDecisionDto }) @IsEnum(AttendanceCorrectionDecisionDto) status!: AttendanceCorrectionDecisionDto;
  @ApiPropertyOptional() @IsOptional() @IsString() reviewNotes?: string;
}

export class UpdateAttendanceDeviceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ipAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}

export class UpdateGeofenceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) radiusMeters?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) allowedAccuracyMeters?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBiometricCredentialDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() revoke?: boolean;
}
