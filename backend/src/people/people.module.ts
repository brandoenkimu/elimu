import { Global, Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { ConnectionsController, PeopleController, ProfileController } from './people.controller';
import { PeopleService } from './people.service';

@Global()
@Module({
  controllers: [ProfileController, PeopleController, ConnectionsController],
  providers: [PeopleService, ConnectionsService],
  exports: [ConnectionsService, PeopleService],
})
export class PeopleModule {}
