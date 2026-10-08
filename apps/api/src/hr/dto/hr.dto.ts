import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export enum EmploymentStatusDto {
  PROBATION = 'PROBATION', PERMANENT = 'PERMANENT', CONTRACT = 'CONTRACT', DAILY = 'DAILY',
  PART_TIME = 'PART_TIME', INTERN = 'INTERN', INACTIVE = 'INACTIVE', TERMINATED = 'TERMINATED',
}

export class CreateEmployeeDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tetap berasal dari token.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() positionId?: string;
  @ApiProperty() @IsString() employeeNumber!: string;
  @ApiProperty() @IsString() fullName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiProperty({ enum: EmploymentStatusDto }) @IsEnum(EmploymentStatusDto) employmentStatus!: EmploymentStatusDto;
  @ApiProperty() @IsDateString() hireDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() contractEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() timezone?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; branch tidak dapat dipindahkan melalui endpoint ini.' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() userId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() positionId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ enum: EmploymentStatusDto }) @IsOptional() @IsEnum(EmploymentStatusDto) employmentStatus?: EmploymentStatusDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateDepartmentDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}

export class CreatePositionDto {
  @ApiPropertyOptional({ description: 'Kompatibilitas lama; company tetap berasal dari token.' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() grade?: string;
}


export class CreateLeaveTypeDto {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() paid?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) annualQuota?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresDocument?: boolean;
}

export class CreateLeaveRequestDto {
  @ApiProperty() @IsUUID() leaveTypeId!: string;
  @ApiProperty() @IsDateString() startDate!: string;
  @ApiProperty() @IsDateString() endDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() documentObjectKey?: string;
}

export enum HrReviewDecisionDto { APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
export class ReviewHrRequestDto {
  @ApiProperty({ enum: HrReviewDecisionDto }) @IsEnum(HrReviewDecisionDto) status!: HrReviewDecisionDto;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateOvertimeRequestDto {
  @ApiProperty() @IsDateString() requestedStart!: string;
  @ApiProperty() @IsDateString() requestedEnd!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class ReviewOvertimeRequestDto extends ReviewHrRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) approvedMinutes?: number;
}


export class CreateEmployeeAssignmentDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() positionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerEmployeeId?: string;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
}
