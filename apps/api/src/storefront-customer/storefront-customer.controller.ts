import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { ConfirmCustomerVerificationDto, CreateCustomerAddressDto, CreateProductReviewDto, LoginStorefrontCustomerDto, RegisterStorefrontCustomerDto, RequestCustomerVerificationDto, UpdateCustomerAddressDto, UpdateStorefrontProfileDto } from './dto/storefront-customer.dto';
import { StorefrontCustomerService } from './storefront-customer.service';

@ApiTags('storefront-customer')
@Public()
@Controller('storefront/account')
export class StorefrontCustomerController {
  constructor(private readonly service: StorefrontCustomerService) {}

  @Post('register') register(@Body() dto: RegisterStorefrontCustomerDto) { return this.service.register(dto); }
  @Post('login') login(@Body() dto: LoginStorefrontCustomerDto) { return this.service.login(dto); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Post('logout') logout(@Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.logout(branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Get('me') me(@Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.me(branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Patch('me') update(@Body() dto: UpdateStorefrontProfileDto, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.updateProfile(dto, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Post('verification/request') requestVerification(@Body() dto: RequestCustomerVerificationDto, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.requestVerification(dto, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Post('verification/confirm') confirmVerification(@Body() dto: ConfirmCustomerVerificationDto, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.confirmVerification(dto, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @Get('fulfillment-options') fulfillmentOptions(@Headers('x-branch-code') branchCode?: string) { return this.service.fulfillmentOptions(branchCode); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Get('addresses') addresses(@Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.addresses(branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Post('addresses') createAddress(@Body() dto: CreateCustomerAddressDto, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.createAddress(dto, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Patch('addresses/:id') updateAddress(@Param('id') id: string, @Body() dto: UpdateCustomerAddressDto, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.updateAddress(id, dto, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Delete('addresses/:id') removeAddress(@Param('id') id: string, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.removeAddress(id, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Get('favorites') favorites(@Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.favorites(branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Post('favorites/:productId') addFavorite(@Param('productId') productId: string, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.addFavorite(productId, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Delete('favorites/:productId') removeFavorite(@Param('productId') productId: string, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.removeFavorite(productId, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @Get('reviews/product/:productId') productReviews(@Param('productId') productId: string, @Headers('x-branch-code') branchCode?: string) { return this.service.productReviews(productId, branchCode); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Post('reviews') createReview(@Body() dto: CreateProductReviewDto, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.createReview(dto, branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Get('orders') orders(@Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.orders(branchCode, token); }

  @ApiHeader({ name: 'x-branch-code', required: true })
  @ApiHeader({ name: 'x-customer-session', required: true })
  @Get('orders/:number') order(@Param('number') number: string, @Headers('x-branch-code') branchCode?: string, @Headers('x-customer-session') token?: string) { return this.service.order(number, branchCode, token); }
}
