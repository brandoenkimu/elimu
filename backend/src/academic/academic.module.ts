import { Global, Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { AdminAcademicController, ClassesController, PublicCatalogController } from './academic.controller';
import { HomeController } from './home.controller';
import { CatalogService } from './catalog.service';
import { EnrolmentService } from './enrolment.service';

@Global()
@Module({
  imports: [ConversationsModule],
  controllers: [PublicCatalogController, AdminAcademicController, ClassesController, HomeController],
  providers: [CatalogService, EnrolmentService],
  exports: [CatalogService, EnrolmentService],
})
export class AcademicModule {}
