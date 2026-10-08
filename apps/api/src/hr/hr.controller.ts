import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { CreateDepartmentDto, CreateEmployeeAssignmentDto, CreateEmployeeDto, CreateLeaveTypeDto, CreatePositionDto, ReviewHrRequestDto, ReviewOvertimeRequestDto, UpdateEmployeeDto } from './dto/hr.dto';
import { HrService } from './hr.service';

@ApiTags('hr') @ApiBearerAuth() @Controller('hr')
  export class HrController {
  constructor(private readonly hr: HrService) {}

  @Permissions('employee.view') @Get('employees')
  list(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
  ) {
    return this.hr.listEmployees(user, limit, cursor, branchId, search, companyId);
  }

  @Permissions('employee.manage') @Post('employees')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.hr.createEmployee(dto, user);
  }

  @Permissions('employee.manage') @Patch('employees/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.hr.updateEmployee(id, dto, user);
  }


  @Permissions('employee.view') @Get('employees/:id/assignments')
  assignments(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.hr.listAssignments(id, user); }

  @Permissions('employee.manage') @Post('assignments')
  assignment(@Body() dto: CreateEmployeeAssignmentDto, @CurrentUser() user: AuthUser) { return this.hr.createAssignment(dto, user); }

  @Permissions('employee.manage') @Post('departments')
  department(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthUser) {
    return this.hr.createDepartment(dto, user);
  }

  @Permissions('employee.manage') @Post('positions')
  position(@Body() dto: CreatePositionDto, @CurrentUser() user: AuthUser) {
    return this.hr.createPosition(dto, user);
  }

  @Permissions('employee.view') @Get('departments')
  departments(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.hr.listDepartments(user, companyId);
  }

  @Permissions('employee.view') @Get('positions')
  positions(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.hr.listPositions(user, departmentId, companyId);
  }

  @Permissions('leave.view') @Get('leave-types')
  leaveTypes(@CurrentUser() user: AuthUser) { return this.hr.listLeaveTypes(user); }

  @Permissions('leave.manage') @Post('leave-types')
  createLeaveType(@Body() dto: CreateLeaveTypeDto, @CurrentUser() user: AuthUser) { return this.hr.createLeaveType(dto, user); }

  @Permissions('leave.view') @Get('leave-requests')
  leaveRequests(@CurrentUser() user: AuthUser, @Query('status') status?: string) { return this.hr.listLeaveRequests(user, status); }

  @Permissions('leave.approve') @Post('leave-requests/:id/review')
  reviewLeave(@Param('id') id: string, @Body() dto: ReviewHrRequestDto, @CurrentUser() user: AuthUser) { return this.hr.reviewLeave(id, dto, user); }

  @Permissions('overtime.view') @Get('overtime-requests')
  overtimeRequests(@CurrentUser() user: AuthUser, @Query('status') status?: string) { return this.hr.listOvertimeRequests(user, status); }

  @Permissions('overtime.approve') @Post('overtime-requests/:id/review')
  reviewOvertime(@Param('id') id: string, @Body() dto: ReviewOvertimeRequestDto, @CurrentUser() user: AuthUser) { return this.hr.reviewOvertime(id, dto, user); }

}
