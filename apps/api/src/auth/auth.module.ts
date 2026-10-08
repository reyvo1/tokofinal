import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DistributedRateLimitService } from './distributed-rate-limit.service';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    PlatformModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = (config.get<string>('JWT_SECRET') ?? 'development-secret-change-me').trim();
        const environment = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
        const protectedEnvironment = environment === 'production' || environment === 'staging';
        const placeholderSecret = secret === 'development-secret-change-me' || /change[_-]?me|ganti-dengan/i.test(secret);
        if (protectedEnvironment && (placeholderSecret || secret.length < 32)) {
          throw new Error('JWT_SECRET staging/production wajib unik, bukan placeholder, dan minimal 32 karakter.');
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController, ApiKeysController],
  providers: [AuthService, DistributedRateLimitService, ApiKeysService],
  exports: [ApiKeysService],
})
export class AuthModule {}
