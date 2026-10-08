import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateStaffMemoDto, UpdateStaffMemoDto } from './dto/staff-memo.dto';
import { StaffMemosService } from './staff-memos.service';

@ApiTags('staff-memos')
@ApiBearerAuth()
@Controller('staff-memos')
export class StaffMemosController {
  constructor(private readonly memos: StaffMemosService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('includeArchived') includeArchived?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.memos.list(user, includeArchived, search, limit, cursor);
  }

  @Post()
  create(
    @Body() dto: CreateStaffMemoDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.memos.create(dto, idempotencyKey, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffMemoDto, @CurrentUser() user: AuthUser) {
    return this.memos.update(id, dto, user);
  }
}
