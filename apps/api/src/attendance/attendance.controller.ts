import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceCorrectionDecisionDto, CreateAttendanceCorrectionDto, CreateAttendanceDeviceDto, CreateAttendanceEventDto, CreateAttendancePolicyDto, CreateGeofenceDto, CreateWorkShiftDto, EnrollBiometricDto, FingerprintEventDto, ReviewAttendanceCorrectionDto, UpdateAttendanceDeviceDto, UpdateAttendancePolicyDto, UpdateBiometricCredentialDto, UpdateGeofenceDto, UpdateWorkShiftDto, UploadAttendancePhotoDto, UpsertEmployeeScheduleDto } from './dto/attendance.dto';

@ApiTags('attendance') @ApiBearerAuth() @Controller('attendance')
  export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}


  @Permissions('attendance.view')
  @Get('work-shifts')
  workShifts(@CurrentUser() user: AuthUser) { return this.attendance.listWorkShifts(user); }

  @Permissions('attendance.manage')
  @Post('work-shifts')
  createWorkShift(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkShiftDto) { return this.attendance.createWorkShift(user, dto); }

  @Permissions('attendance.manage')
  @Patch('work-shifts/:id')
  updateWorkShift(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWorkShiftDto) { return this.attendance.updateWorkShift(user, id, dto); }

  @Permissions('attendance.view')
  @Get('schedules')
  schedules(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('employeeId') employeeId?: string) {
    return this.attendance.listSchedules(user, from, to, employeeId);
  }

  @Permissions('attendance.manage')
  @Post('schedules')
  schedule(@CurrentUser() user: AuthUser, @Body() dto: UpsertEmployeeScheduleDto) { return this.attendance.upsertSchedule(user, dto); }

  @Permissions('attendance.view')
  @Get('policies')
  policies(@CurrentUser() user: AuthUser) { return this.attendance.listPolicies(user); }

  @Permissions('attendance.manage')
  @Post('policies')
  policy(@CurrentUser() user: AuthUser, @Body() dto: CreateAttendancePolicyDto) { return this.attendance.createPolicy(user, dto); }

  @Permissions('attendance.manage')
  @Patch('policies/:id')
  updatePolicy(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAttendancePolicyDto) { return this.attendance.updatePolicy(user, id, dto); }

  @Permissions('attendance.view')
  @Get('corrections')
  corrections(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('employeeId') employeeId?: string) { return this.attendance.listCorrections(user, status, employeeId); }

  @Permissions('attendance.record')
  @Post('corrections')
  correction(@CurrentUser() user: AuthUser, @Body() dto: CreateAttendanceCorrectionDto) { return this.attendance.submitCorrection(user, dto); }

  @Permissions('attendance.approve')
  @Post('corrections/:id/review')
  reviewCorrection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewAttendanceCorrectionDto) { return this.attendance.reviewCorrection(user, id, dto); }

  @Permissions('attendance.view')
  @Get('devices')
  devices(@CurrentUser() user: AuthUser) { return this.attendance.listDevices(user); }

  @Permissions('attendance.manage')
  @Patch('devices/:id')
  updateDevice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAttendanceDeviceDto) { return this.attendance.updateDevice(user, id, dto); }

  @Permissions('attendance.view')
  @Get('geofences')
  geofences(@CurrentUser() user: AuthUser) { return this.attendance.listGeofences(user); }

  @Permissions('attendance.manage')
  @Patch('geofences/:id')
  updateGeofence(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateGeofenceDto) { return this.attendance.updateGeofence(user, id, dto); }

  @Permissions('attendance.view')
  @Get('biometrics')
  biometrics(@CurrentUser() user: AuthUser, @Query('employeeId') employeeId?: string) { return this.attendance.listBiometrics(user, employeeId); }

  @Permissions('attendance.manage')
  @Patch('biometrics/:id')
  updateBiometric(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBiometricCredentialDto) { return this.attendance.updateBiometric(user, id, dto); }

  @Permissions('attendance.record')
  @Get('config')
  config(@CurrentUser() user: AuthUser, @Query('employeeId') employeeId: string) {
    return this.attendance.employeeConfig(user, employeeId);
  }

  @Permissions('attendance.record')
  @Post('media/upload-local')
  upload(@CurrentUser() user: AuthUser, @Body() dto: UploadAttendancePhotoDto) {
    return this.attendance.uploadLocalPhoto(user, dto);
  }

  @Permissions('attendance.record')
  @Post('events')
  record(@CurrentUser() user: AuthUser, @Body() dto: CreateAttendanceEventDto) {
    return this.attendance.record(user, dto);
  }

  @Permissions('attendance.device_ingest')
  @Post('devices/fingerprint/events')
  fingerprint(@CurrentUser() user: AuthUser, @Body() dto: FingerprintEventDto) {
    return this.attendance.ingestFingerprint(user, dto);
  }

  @Permissions('attendance.manage')
  @Post('devices')
  device(@CurrentUser() user: AuthUser, @Body() dto: CreateAttendanceDeviceDto) {
    return this.attendance.createDevice(user, dto);
  }

  @Permissions('attendance.manage')
  @Post('geofences')
  geofence(@CurrentUser() user: AuthUser, @Body() dto: CreateGeofenceDto) {
    return this.attendance.createGeofence(user, dto);
  }

  @Permissions('attendance.manage')
  @Post('biometrics/enroll')
  enroll(@CurrentUser() user: AuthUser, @Body() dto: EnrollBiometricDto) {
    return this.attendance.enroll(user, dto);
  }

  @Permissions('attendance.view')
  @Get('employee')
  list(
    @CurrentUser() user: AuthUser,
    @Query('employeeId') employeeId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.attendance.listEmployee(user, employeeId, limit, cursor);
  }
}
