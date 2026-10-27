import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends email through SMTP when SMTP_HOST is configured.
 *
 * Without SMTP (typical on a development laptop) nothing is sent. In development the
 * message, including any reset link, is printed to this server's console so the flow
 * can still be tested. In production nothing sensitive is ever logged.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter | null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.transport = cfg.SMTP
      ? createTransport({
          host: cfg.SMTP.host,
          port: cfg.SMTP.port,
          secure: cfg.SMTP.secure,
          auth: cfg.SMTP.user ? { user: cfg.SMTP.user, pass: cfg.SMTP.pass } : undefined,
        })
      : null;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  async send(mail: Mail): Promise<void> {
    if (!this.transport || !this.cfg.SMTP) {
      if (this.cfg.NODE_ENV !== 'production') {
        this.log.warn(
          `SMTP is not configured, so this email was NOT sent. Development copy:\n` +
            `  To:      ${mail.to}\n  Subject: ${mail.subject}\n  ${mail.text.split('\n').join('\n  ')}`,
        );
      } else {
        this.log.warn(`SMTP is not configured; an email to a user could not be sent ("${mail.subject}").`);
      }
      return;
    }
    try {
      await this.transport.sendMail({ from: this.cfg.SMTP.from, ...mail });
    } catch (err) {
      this.log.error(`Could not send "${mail.subject}": ${(err as Error).message}`);
    }
  }

  /** Sends sign-in details for an account an administrator created. Returns whether an email actually went out. */
  async sendWelcome(to: string, name: string, temporaryPassword: string): Promise<boolean> {
    if (!this.transport) {
      await this.send({ to, subject: 'Your Elimu account', text: `Hello ${name},\nTemporary password: ${temporaryPassword}\nYou will be asked to choose a new one at first sign-in.` });
      return false;
    }
    await this.send({
      to,
      subject: 'Your Elimu account is ready',
      text:
        `Hello ${name},\n\nAn account has been created for you on Elimu.\n` +
        `Sign in at ${this.cfg.APP_URL} with this temporary password:\n\n  ${temporaryPassword}\n\n` +
        `You will be asked to choose a new password straight away. If you were not expecting this email, you can ignore it.`,
    });
    return true;
  }
}
