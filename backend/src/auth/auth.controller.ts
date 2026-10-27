import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { AllowWhenPasswordChangeRequired } from '../common/roles';
import type { AuthUser } from '../common/types';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { RateLimit } from '../rate-limit/rate-limit.guard';
import {
  ChangePasswordDto,
  ForgotDto,
  LoginDto,
  RegisterDto,
  ResetDto,
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  registerSchema,
  resetSchema,
} from './auth.dto';
import { AuthGuard, CurrentUser, OriginGuard } from './auth.guard';
import { AuthService, Session } from './auth.service';

const REFRESH_COOKIE = 'cc_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post('register')
  @RateLimit({ bucket: 'register', limit: 20, windowSec: 3600, failClosed: true })
  async register(@Body(new ZodPipe(registerSchema)) dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto);
    if ('pending' in result) {
      return { pending: true, message: 'Thank you. An administrator will review your account. You can sign in once it is approved.' };
    }
    return this.respond(res, result.session);
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit({ bucket: 'login', limit: 30, windowSec: 60, failClosed: true })
  async login(
    @Body(new ZodPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(dto, req.ip ?? 'unknown'));
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  @RateLimit({ bucket: 'refresh', limit: 60, windowSec: 60 })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(this.readCookie(req)));
    } catch (err) {
      // A dead session should not leave a dead cookie behind. Keep it for the
      // rotation race, where the browser is about to receive the new one.
      const code = (err as { getResponse?: () => { code?: string } }).getResponse?.()?.code;
      if (code !== 'REFRESH_RACE') this.clearCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.readCookie(req));
    this.clearCookie(res);
  }

  /** Sign out of every device, including this one. */
  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(AuthGuard, OriginGuard)
  @AllowWhenPasswordChangeRequired()
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(user.id);
    this.clearCookie(res);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @AllowWhenPasswordChangeRequired()
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.auth.me(user.id) };
  }

  @Post('forgot')
  @HttpCode(200)
  @RateLimit({ bucket: 'forgot-ip', limit: 10, windowSec: 3600 })
  forgot(@Body(new ZodPipe(forgotSchema)) dto: ForgotDto, @Req() req: Request) {
    this.auth.forgot(dto.email, req.ip ?? 'unknown');
    // Identical answer whether or not the address has an account.
    return { ok: true, message: 'If that email belongs to an account, a reset link is on its way.' };
  }

  @Post('reset')
  @HttpCode(200)
  @RateLimit({ bucket: 'reset-ip', limit: 10, windowSec: 3600 })
  async reset(@Body(new ZodPipe(resetSchema)) dto: ResetDto) {
    await this.auth.reset(dto);
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AuthGuard, OriginGuard)
  @AllowWhenPasswordChangeRequired()
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.changePassword(user.id, dto));
  }

  private respond(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.cfg.cookieSecure,
      sameSite: this.cfg.COOKIE_SAMESITE,
      // Scoped to the auth routes so the cookie is not sent with every chat request.
      path: '/api/auth',
      // No expiry for "don't remember me": the browser drops the cookie when it closes.
      ...(session.persistent ? { expires: session.refreshExpiresAt } : {}),
    });
    res.setHeader('Cache-Control', 'no-store');
    return { accessToken: session.accessToken, expiresInSec: session.expiresInSec, user: session.user };
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.cfg.cookieSecure,
      sameSite: this.cfg.COOKIE_SAMESITE,
      path: '/api/auth',
    });
  }

  private readCookie(req: Request): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
    return typeof value === 'string' ? value : undefined;
  }
}
