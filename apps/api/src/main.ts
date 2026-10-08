import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  app.useBodyParser('json', { limit: config.get<string>('API_JSON_BODY_LIMIT') ?? '12mb' });
  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const environment = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const production = environment === 'production';
  const protectedEnvironment = production || environment === 'staging';
  if (protectedEnvironment && !origins.length) throw new Error('CORS_ORIGINS wajib dikonfigurasi pada staging/production.');
  if (protectedEnvironment && origins.includes('*')) throw new Error('CORS_ORIGINS staging/production tidak boleh wildcard (*).');

  app.use((req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.setGlobalPrefix('api/v1');
  // Header yang diizinkan pada preflight harus lengkap. Default Nest hanya mencantumkan header
  // "simple" plus Authorization. Aplikasi Admin (page.tsx:196) mengirim `Content-Type:
  // application/json` pada SETIAP request lewat authFetch, jadi preflight menanyakan
  // `content-type` - yang tidak ada di allow-list - dan browser menolak seluruh request dengan
  // net::ERR_FAILED tanpa status HTTP. Gejalanya: "Gagal memuat: Produk, Konfigurasi aplikasi,
  // Konteks cabang" di UI, padahal API sehat dan endpoint-nya 200.
  app.enableCors({
    origin: origins.length ? origins : !protectedEnvironment,
    credentials: true,
    // Jangan pakai '*': with credentials, browser menolak, dan protectedEnvironment di atas
    // sudah melarangnya. Daftar eksplisit di sini yang penting: client nyata mengirim
    // content-type, authorization, dan Accept.
    //
    // Header kustom WAJIB ikut tercantum. Setiap header yang tidak "simple" memaksa browser
    // mengirim preflight OPTIONS, dan kalau header itu tidak ada di allow-list, browser
    // membatalkan request dengan TypeError "Failed to fetch" - TANPA status HTTP, sehingga
    // server tidak pernah tahu ada yang gagal.
    //
    // Bug yang sama sudah terjadi dua kali: content-type (UI Admin gagal memuat data padahal
    // endpoint 200), lalu x-branch-code (storefront). Katalog storefront membungkus keempat
    // fetch-nya dalam satu Promise.all, jadi satu preflight yang ditolak menolak SEMUA
    // promise: setProducts tidak pernah dipanggil dan katalog menampilkan "Katalog belum
    // tersedia" padahal /products membalas 200 dengan produk aktif.
    //
    // Daftar di bawah adalah-- header kustom yang benar-benar dikirim client di repo ini,
    // diverifikasi dengan grep, bukan tebakan: storefront mengirim x-branch-code dan
    // x-customer-session, POS/POSITIVE mengirim x-order-access-token, dan API key memakai
    // x-api-key. Menambah header baru di client tanpa menambahkannya di sini akan
    // reproducing bug yang sama.
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'X-Requested-With',
      'X-Branch-Code',
      'X-Customer-Session',
      'X-Order-Access-Token',
      'X-Api-Key',
    ],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Toko360 API')
    .setDescription('API toko online, kasir, gudang, supplier, pembayaran, pengguna, dan keuangan.')
    .setVersion(process.env.APP_VERSION ?? '0.5.3')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(config.get<string>('API_PORT') ?? 4000);
  await app.listen(port);
  console.log(`Toko360 API berjalan di http://localhost:${port}/api/v1`);
  console.log(`Swagger tersedia di http://localhost:${port}/docs`);
}

void bootstrap();
