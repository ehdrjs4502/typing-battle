import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { UseFilters, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '@typing-battle/shared';
import { GameService } from './game.service';
import { RoomsService } from '../rooms/rooms.service';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';
import { JwtPayload } from '../auth/jwt.strategy';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/game' })
@UseFilters(WsExceptionFilter)
export class GameGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // socketId → { userId, roomId }
  private socketMap = new Map<string, { userId: string; nickname: string; roomId: string }>();

  constructor(
    private gameService: GameService,
    private roomsService: RoomsService,
  ) {}

  handleDisconnect(client: Socket) {
    const info = this.socketMap.get(client.id);
    if (!info) return;
    this.socketMap.delete(client.id);

    const room = this.gameService.removePlayer(info.roomId, info.userId);
    if (room) {
      this.server.to(info.roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.JOIN_ROOM)
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    const user: JwtPayload = client.data.user;
    const dbRoom = await this.roomsService.findOne(payload.roomId).catch(() => null);
    if (!dbRoom) throw new WsException('방을 찾을 수 없습니다.');

    const room = this.gameService.getOrCreateRoom(
      dbRoom.id,
      dbRoom.hostId,
      dbRoom.name,
      dbRoom.maxPlayers,
    );

    if (room.players.length >= room.maxPlayers) {
      throw new WsException('방이 꽉 찼습니다.');
    }

    this.gameService.addPlayer(payload.roomId, {
      id: user.sub,
      nickname: user.nickname,
      isReady: false,
      isHost: dbRoom.hostId === user.sub,
    });

    client.join(payload.roomId);
    this.socketMap.set(client.id, {
      userId: user.sub,
      nickname: user.nickname,
      roomId: payload.roomId,
    });

    this.server.to(payload.roomId).emit(SOCKET_EVENTS.ROOM_STATE, this.gameService.getRoom(payload.roomId));
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.LEAVE_ROOM)
  handleLeaveRoom(@ConnectedSocket() client: Socket) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    client.leave(info.roomId);
    this.socketMap.delete(client.id);

    const room = this.gameService.removePlayer(info.roomId, info.userId);
    if (room) {
      this.server.to(info.roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.PLAYER_READY)
  handlePlayerReady(@ConnectedSocket() client: Socket) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    const room = this.gameService.setPlayerReady(info.roomId, info.userId);
    if (room) {
      this.server.to(info.roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('start_game')
  async handleStartGame(@ConnectedSocket() client: Socket) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    const room = this.gameService.getRoom(info.roomId);
    if (!room || room.hostId !== info.userId) {
      throw new WsException('방장만 게임을 시작할 수 있습니다.');
    }
    if (!this.gameService.canStart(info.roomId)) {
      throw new WsException('모든 플레이어가 준비되어야 합니다.');
    }

    // 카운트다운
    for (let i = 3; i > 0; i--) {
      this.server.to(info.roomId).emit(SOCKET_EVENTS.GAME_STARTING, { countdown: i });
      await sleep(1000);
    }

    const result = this.gameService.startGame(info.roomId);
    if (!result) return;

    await this.roomsService.updateStatus(info.roomId, 'PLAYING');
    this.server.to(info.roomId).emit(SOCKET_EVENTS.GAME_START, { text: result.text });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.TYPING_PROGRESS)
  handleTypingProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { progress: number; wpm: number },
  ) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    client.to(info.roomId).emit(SOCKET_EVENTS.PLAYER_PROGRESS, {
      userId: info.userId,
      progress: payload.progress,
      wpm: payload.wpm,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.TYPING_COMPLETE)
  async handleTypingComplete(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { wpm: number; accuracy: number; timeMs: number },
  ) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    const rank = this.gameService.recordFinish(info.roomId, info.userId);

    this.server.to(info.roomId).emit(SOCKET_EVENTS.PLAYER_FINISHED, {
      userId: info.userId,
      nickname: info.nickname,
      rank,
      ...payload,
    });

    if (this.gameService.isGameOver(info.roomId)) {
      const room = this.gameService.endGame(info.roomId);
      if (room) {
        await this.roomsService.updateStatus(info.roomId, 'FINISHED');
        this.server.to(info.roomId).emit(SOCKET_EVENTS.GAME_END, { results: [] });
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
