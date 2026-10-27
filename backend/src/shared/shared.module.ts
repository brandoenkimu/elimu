import { Global, Module } from '@nestjs/common';
import { RolesGuard } from '../common/roles';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { MailService } from './mail.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Services nearly every feature needs, available app-wide without importing this module again. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [AccessService, AuditService, MailService, NotificationsService, RolesGuard],
  exports: [AccessService, AuditService, MailService, NotificationsService, RolesGuard],
})
export class SharedModule {}
