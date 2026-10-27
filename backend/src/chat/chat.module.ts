import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.repository';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [AuthModule, MessagesModule, UsersModule],
  providers: [ChatGateway],
})
export class ChatModule {}
