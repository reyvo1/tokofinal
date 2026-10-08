import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { decodeCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { Permissions } from '../auth/permissions.decorator';
import { HrService } from '../hr/hr.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestChannelBindingDto, SubmitAttendanceCorrectionDto, UpdateNotificationPreferenceDto, VerifyChannelBindingDto } from './employee-self-service.dto';
import { CreateLeaveRequestDto, CreateOvertimeRequestDto } from '../hr/dto/hr.dto';
import { EmployeeSelfServiceService } from './employee-self-service.service';

@ApiTags('employee-self-service') @ApiBearerAuth() @Controller('employee/me')
  export class EmployeeSelfServiceController {
  constructor(
    private readonly hr: HrService,
    private readonly prisma: PrismaService,
    private readonly selfService: EmployeeSelfServiceService,
  ) {}


  @Permissions('employee.self') @Get('channels')
  channels(@CurrentUser() user: AuthUser) { return this.selfService.channelState(user); }

  @Permissions('employee.self') @Get('notification-preferences')
  preferences(@CurrentUser() user: AuthUser) { return this.selfService.preferences(user); }

  @Permissions('employee.self') @Get('attendance-corrections')
  corrections(@CurrentUser() user: AuthUser) { return this.selfService.corrections(user); }

  @Permissions('employee.self') @Post('attendance-corrections')
  submitCorrection(@CurrentUser() user: AuthUser, @Body() dto: SubmitAttendanceCorrectionDto) { return this.selfService.submitAttendanceCorrection(user, dto); }

  @Permissions('employee.self') @Post('channels/request-verification')
  requestChannel(@CurrentUser() user: AuthUser, @Body() dto: RequestChannelBindingDto) {
    return this.selfService.requestBinding(user, dto);
  }

  @Permissions('employee.self') @Post('channels/verify')
  verifyChannel(@CurrentUser() user: AuthUser, @Body() dto: VerifyChannelBindingDto) {
    return this.selfService.verifyBinding(user, dto);
  }

  @Permissions('employee.self') @Post('notification-preferences')
  preference(@CurrentUser() user: AuthUser, @Body() dto: UpdateNotificationPreferenceDto) {
    return this.selfService.updatePreference(user, dto);
  }

  @Permissions('employee.self') @Get()
  async profile(@CurrentUser() user: AuthUser) {
    return this.hr.byUserId(user);
  }

  @Permissions('employee.self') @Get('attendance')
  async attendance(@CurrentUser() user: AuthUser, @Query('limit') limitInput?: string, @Query('cursor') cursorInput?: string) {
    const employee = await this.hr.byUserId(user);
    const limit = parsePageLimit(limitInput);
    const cursor = decodeCursor<{ workDate: string; id: string }>(cursorInput);
    const items = await this.prisma.attendanceRecord.findMany({
      where: {
        companyId: employee.companyId,
        branchId: employee.branchId,
        employeeId: employee.id,
        ...(cursor ? { OR: [
          { workDate: { lt: new Date(cursor.workDate) } },
          { workDate: new Date(cursor.workDate), id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(items, limit, (item) => ({ workDate: item.workDate.toISOString(), id: item.id }));
  }

  @Permissions('employee.self') @Get('payslips')
  async payslips(@CurrentUser() user: AuthUser, @Query('limit') limitInput?: string, @Query('cursor') cursorInput?: string) {
    const employee = await this.hr.byUserId(user);
    const limit = parsePageLimit(limitInput);
    const cursor = decodeCursor<{ createdAt: string; id: string }>(cursorInput);
    const items = await this.prisma.payslip.findMany({
      where: {
        companyId: employee.companyId,
        employeeId: employee.id,
        ...(cursor ? { OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toCursorPage(items, limit, (item) => ({ createdAt: item.createdAt.toISOString(), id: item.id }));
  }

  @Permissions('employee.self') @Get('payslips/:id')
  async payslip(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const employee = await this.hr.byUserId(user);
    const payslip = await this.prisma.payslip.findFirst({
      where: { id, companyId: employee.companyId, employeeId: employee.id },
    });
    if (payslip && !payslip.viewedAt) {
      await this.prisma.payslip.update({ where: { id }, data: { viewedAt: new Date() } });
    }
    return payslip;
  }

  @Permissions('employee.self') @Get('leave-types')
  leaveTypes(@CurrentUser() user: AuthUser) { return this.hr.listLeaveTypes(user); }

  @Permissions('employee.self') @Get('leave-requests')
  leaveRequests(@CurrentUser() user: AuthUser) { return this.hr.myLeaveRequests(user); }

  @Permissions('employee.self') @Post('leave-requests')
  submitLeave(@CurrentUser() user: AuthUser, @Body() dto: CreateLeaveRequestDto) { return this.hr.submitLeave(dto, user); }

  @Permissions('employee.self') @Get('overtime-requests')
  overtimeRequests(@CurrentUser() user: AuthUser) { return this.hr.myOvertimeRequests(user); }

  @Permissions('employee.self') @Post('overtime-requests')
  submitOvertime(@CurrentUser() user: AuthUser, @Body() dto: CreateOvertimeRequestDto) { return this.hr.submitOvertime(dto, user); }

}
