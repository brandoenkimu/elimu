import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AccessClaims {
  sub: string;
  exp: number;
  iat: number;
}

/**
 * Access tokens are short-lived, stateless JWTs signed with HS256. Every node
 * shares JWT_ACCESS_SECRET, so a token issued by NODE_A is accepted by NODE_B
 * and NODE_C. That is what lets a client fail over without logging in again.
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(userId: string): Promise<string> {
    return this.jwt.signAsync({}, { subject: userId });
  }

  /** Throws if the token is malformed, expired, or signed with another secret/algorithm. */
  verify(token: string): Promise<AccessClaims> {
    return this.jwt.verifyAsync<AccessClaims>(token);
  }
}
