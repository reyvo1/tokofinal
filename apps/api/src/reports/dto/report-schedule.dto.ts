import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { REPORT_TYPES } from './create-report-job.dto';

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const FORMATS = ['CSV', 'XLSX', 'PDF'] as const;

export class CreateReportScheduleDto {
  @IsString()
  name!: string;

  @IsString()
  @IsIn(REPORT_TYPES)
  reportType!: string;

  @IsOptional()
  @IsIn(FORMATS)
  format?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsIn(FREQUENCIES)
  frequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY';

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'localTime harus HH:mm.' })
  localTime!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateReportScheduleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() @IsIn(REPORT_TYPES) reportType?: string;
  @IsOptional() @IsIn(FORMATS) format?: string;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @IsOptional() @IsIn(FREQUENCIES) frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'localTime harus HH:mm.' }) localTime?: string;
  @IsOptional() @IsInt() @Min(0) @Max(6) dayOfWeek?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
