import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { FleetService } from './fleet.service';
import { CloseTripDto, CompleteStopDto, ConfirmLoadingDto, CreateDeliveryTripDto, CreateVehicleDriverAssignmentDto, CreateVehicleDto, DispatchTripDto, EndVehicleDriverAssignmentDto, RecordFuelDto } from './dto/fleet.dto';

@ApiTags('fleet') @ApiBearerAuth() @Controller('fleet')
  export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Permissions('fleet.view') @Get('vehicles')
  vehicles(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.fleet.listVehicles(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Permissions('fleet.view') @Get('driver-assignments')
  driverAssignments(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.fleet.listDriverAssignments(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('fleet.manage') @Post('driver-assignments')
  createDriverAssignment(@Body() dto: CreateVehicleDriverAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.fleet.createDriverAssignment(dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('fleet.manage') @Post('driver-assignments/:id/end')
  endDriverAssignment(@Param('id') id: string, @Body() dto: EndVehicleDriverAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.fleet.endDriverAssignment(id, dto, user);
  }


  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Permissions('fleet.view') @Get('summary')
  summary(@CurrentUser() user: AuthUser) { return this.fleet.summary(user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE','AUDITOR') @Permissions('fleet.view') @Get('trips')
  trips(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.fleet.listTrips(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE','AUDITOR') @Permissions('fleet.view') @Get('fuel')
  fuelList(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) { return this.fleet.listFuel(user, companyId, branchId); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN') @Permissions('fleet.manage') @Post('vehicles')
  vehicle(@Body() dto: CreateVehicleDto, @CurrentUser() user: AuthUser) { return this.fleet.createVehicle(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('delivery.trip.manage') @Post('trips')
  trip(@Body() dto: CreateDeliveryTripDto, @CurrentUser() user: AuthUser) { return this.fleet.createTrip(dto, user); }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('delivery.loading.confirm') @Post('trips/:id/loading')
  loading(@Param('id') id: string, @Body() dto: ConfirmLoadingDto, @CurrentUser() user: AuthUser) {
    return this.fleet.confirmLoading(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('delivery.dispatch') @Post('trips/:id/dispatch')
  dispatch(@Param('id') id: string, @Body() dto: DispatchTripDto, @CurrentUser() user: AuthUser) {
    return this.fleet.dispatch(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('delivery.proof') @Post('stops/:id/complete')
  stop(@Param('id') id: string, @Body() dto: CompleteStopDto, @CurrentUser() user: AuthUser) {
    return this.fleet.completeStop(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','WAREHOUSE') @Permissions('delivery.trip.manage') @Post('trips/:id/close')
  close(@Param('id') id: string, @Body() dto: CloseTripDto, @CurrentUser() user: AuthUser) {
    return this.fleet.closeTrip(id, dto, user);
  }

  @Roles('SUPER_ADMIN','OWNER','ADMIN','FINANCE','WAREHOUSE') @Permissions('fleet.expense') @Post('fuel')
  fuel(@Body() dto: RecordFuelDto, @CurrentUser() user: AuthUser) { return this.fleet.recordFuel(dto, user); }
}
