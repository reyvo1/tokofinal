import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { CreateCustomerOrderReturnDto } from './dto/order-return.dto';
import { ReturnsService } from './returns.service';

@ApiTags('storefront-order-returns')
@Public()
@Controller('storefront/account/returns')
export class StorefrontOrderReturnsController {
  constructor(private readonly service: ReturnsService) {}

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Get()
  list(@Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) {
    return this.service.listCustomerOrderReturns(branchCode, token);
  }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Post()
  create(
    @Body() dto: CreateCustomerOrderReturnDto,
    @Headers('x-branch-code') branchCode?: string,
    @Headers('x-customer-session') token?: string,
  ) {
    return this.service.createCustomerOrderReturn(dto, branchCode, token);
  }
}
