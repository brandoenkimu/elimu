import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthGuard, OriginGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

export const JWT_ISSUER = 'campusconnect';
export const JWT_AUDIENCE = 'campusconnect-web';

/** Global so any feature module can use @UseGuards(AuthGuard) without importing this module. */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        secret: cfg.JWT_ACCESS_SECRET,
        // Pinning the algorithm on both sign and verify rules out "alg: none"
        // and algorithm-confusion attacks.
        signOptions: {
          algorithm: 'HS256' as const,
          expiresIn: cfg.ACCESS_TOKEN_TTL_SEC,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
        verifyOptions: {
          algorithms: ['HS256' as const],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, AuthGuard, OriginGuard],
  exports: [TokenService, AuthGuard, AuthService],
})
export class AuthModule {}
