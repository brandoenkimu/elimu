import { Module } from '@nestjs/common';
import { AcademicModule } from './academic/academic.module';
import { AdminModule } from './admin/admin.module';
import { AssessmentsModule } from './assessments/assessments.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { ClassroomModule } from './classroom/classroom.module';
import { ConfigModule } from './config/app-config';
import { ConversationsModule } from './conversations/conversations.module';
import { DatabaseModule } from './database/database.service';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health/health.controller';
import { MessagesModule } from './messages/messages.module';
import { PeopleModule } from './people/people.module';
import { RateLimitModule } from './rate-limit/rate-limit.guard';
import { RealtimeModule } from './realtime/realtime.bus';
import { RedisModule } from './redis/redis.service';
import { SharedModule } from './shared/shared.module';
import { UsersModule } from './users/users.repository';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    RealtimeModule,
    UsersModule,
    SharedModule,
    PeopleModule,
    AuthModule,
    FilesModule,
    ConversationsModule,
    MessagesModule,
    AcademicModule,
    AdminModule,
    ClassroomModule,
    AssessmentsModule,
    AttendanceModule,
    EvaluationsModule,
    ChatModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
