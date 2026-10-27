import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { Server } from 'socket.io';

export type Delivery = 'cluster' | 'local';

/**
 * Small bridge that lets REST services and the Socket.IO gateway talk to the
 * same Socket.IO server without importing each other (which would be circular).
 *
 * It also tracks whether the Redis adapter is currently connected. When Redis is
 * down, emits are restricted to this node's own sockets instead of failing, and
 * callers are told about it so acknowledgements stay truthful.
 */
@Injectable()
export class RealtimeBus {
  private readonly log = new Logger('Realtime');
  private server?: Server;
  private redisReady = false;
  private wasDown = false;

  attachServer(server: Server): void {
    this.server = server;
  }

  setRedisReady(ready: boolean): void {
    if (ready === this.redisReady) return;
    this.redisReady = ready;
    if (!ready) {
      this.wasDown = true;
      this.log.warn('Redis adapter disconnected: broadcasts are limited to this node until it recovers.');
      return;
    }
    if (this.wasDown) {
      this.wasDown = false;
      this.log.log('Redis adapter reconnected. Asking local clients to re-sync.');
      // Messages sent on other nodes while Redis was down were saved but not pushed here.
      this.server?.local.emit('sync:required');
    }
  }

  isRedisReady(): boolean {
    return this.redisReady;
  }

  connectionCount(): number {
    return this.server?.engine?.clientsCount ?? 0;
  }

  /** Pushes an event to everyone in a conversation, on every node when Redis is up. */
  emitToConversation(conversationId: string, event: string, payload: unknown): Delivery {
    if (!this.server) return 'local';
    const room = `conv:${conversationId}`;
    if (this.redisReady) {
      this.server.to(room).emit(event, payload);
      return 'cluster';
    }
    this.server.local.to(room).emit(event, payload);
    return 'local';
  }

  /** Pushes an event to every open session of one user, on whichever node they are connected to. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    const room = `user:${userId}`;
    try {
      if (this.redisReady) this.server.to(room).emit(event, payload);
      else this.server.local.to(room).emit(event, payload);
    } catch (err) {
      this.log.warn(`Could not push "${event}" to user ${userId}: ${(err as Error).message}`);
    }
  }

  /** Drops every open socket of a user (suspension, role change, password reset). */
  disconnectUser(userId: string): void {
    if (!this.server) return;
    try {
      const target = this.redisReady ? this.server.in(`user:${userId}`) : this.server.local.in(`user:${userId}`);
      target.disconnectSockets(true);
    } catch (err) {
      this.log.warn(`Could not disconnect user ${userId}: ${(err as Error).message}`);
    }
  }

  /** Removes a user's open sockets from a conversation room (they were removed from the class or group). */
  async removeUserFromConversation(userId: string, conversationId: string): Promise<void> {
    if (!this.server) return;
    try {
      const target = this.redisReady ? this.server.in(`user:${userId}`) : this.server.local.in(`user:${userId}`);
      await target.socketsLeave(`conv:${conversationId}`);
    } catch (err) {
      this.log.warn(`Could not update live sockets for user ${userId}: ${(err as Error).message}`);
    }
  }

  /** Makes all of a user's open sockets (on any node) join a conversation room. */
  async addUserToConversation(userId: string, conversationId: string): Promise<void> {
    if (!this.server) return;
    try {
      const target = this.redisReady ? this.server.in(`user:${userId}`) : this.server.local.in(`user:${userId}`);
      await target.socketsJoin(`conv:${conversationId}`);
    } catch (err) {
      // The user is a member in the database either way; their sockets pick the
      // room up on the next connection.
      this.log.warn(`Could not update live sockets for user ${userId}: ${(err as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [RealtimeBus], exports: [RealtimeBus] })
export class RealtimeModule {}
