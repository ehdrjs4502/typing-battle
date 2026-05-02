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

  async handleDisconnect(client: Socket) {
    const info = this.socketMap.get(client.id);
    if (!info) return;
    this.socketMap.delete(client.id);

    const room = this.gameService.removePlayer(info.roomId, info.userId);
    if (room) {
      this.server.to(info.roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);
    } else {
      // 방이 비어서 인메모리에서 삭제됨 → DB 에서도 정리
      await this.roomsService.delete(info.roomId);
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

    // DB 방장이 재접속하면 인메모리 방장 상태를 복원 (새로고침 대응)
    if (dbRoom.hostId === user.sub) {
      this.gameService.setRoomHost(payload.roomId, user.sub);
    }

    client.join(payload.roomId);
    this.socketMap.set(client.id, {
      userId: user.sub,
      nickname: user.nickname,
      roomId: payload.roomId,
    });

    const currentRoom = this.gameService.getRoom(payload.roomId)!;
    this.server.to(payload.roomId).emit(SOCKET_EVENTS.ROOM_STATE, currentRoom);

    // 게임 진행 중에 재접속한 경우 해당 클라이언트에게만 텍스트 재전송
    if (currentRoom.status === 'PLAYING' && currentRoom.currentText) {
      client.emit(SOCKET_EVENTS.GAME_START, { text: currentRoom.currentText });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.LEAVE_ROOM)
  async handleLeaveRoom(@ConnectedSocket() client: Socket) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    client.leave(info.roomId);
    this.socketMap.delete(client.id);

    const room = this.gameService.removePlayer(info.roomId, info.userId);
    if (room) {
      this.server.to(info.roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);
    } else {
      await this.roomsService.delete(info.roomId);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.PLAYER_READY)
  async handlePlayerReady(@ConnectedSocket() client: Socket) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    const room = this.gameService.togglePlayerReady(info.roomId, info.userId);
    if (!room) return;
    this.server.to(info.roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);

    // 모두 준비되면 자동으로 카운트다운을 시작한다 (방장의 명시적 시작 버튼이 없어도 진행되도록).
    if (this.gameService.canStart(info.roomId) && room.status === 'WAITING') {
      await this.runStartSequence(info.roomId);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.START_GAME)
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

    await this.runStartSequence(info.roomId);
  }

  private async runStartSequence(roomId: string) {
    const room = this.gameService.getRoom(roomId);
    if (!room) return;
    // 카운트다운 중 중복 시작을 막기 위해 즉시 PLAYING 으로 표시
    room.status = 'PLAYING';
    this.server.to(roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);

    for (let i = 3; i > 0; i--) {
      this.server.to(roomId).emit(SOCKET_EVENTS.GAME_STARTING, { countdown: i });
      await sleep(1000);
    }

    const result = this.gameService.startGame(roomId);
    if (!result) return;

    await this.roomsService.updateStatus(roomId, 'PLAYING');
    this.server.to(roomId).emit(SOCKET_EVENTS.GAME_START, { text: result.text });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(SOCKET_EVENTS.SURRENDER)
  async handleSurrender(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { timeMs: number },
  ) {
    const info = this.socketMap.get(client.id);
    if (!info) return;

    const result = this.gameService.recordSurrender(
      info.roomId,
      info.userId,
      info.nickname,
      payload.timeMs,
    );
    if (!result) return;

    this.server.to(info.roomId).emit(SOCKET_EVENTS.PLAYER_SURRENDERED, {
      userId: info.userId,
      nickname: info.nickname,
    });
    // 항복한 플레이어 본인에게 결과 전달
    this.server.to(info.roomId).emit(SOCKET_EVENTS.PLAYER_FINISHED, result);

    if (this.gameService.isGameOver(info.roomId)) {
      const ended = this.gameService.endGame(info.roomId);
      if (ended) {
        await this.roomsService.updateStatus(info.roomId, 'FINISHED');
        await this.roomsService.saveResults(
          info.roomId,
          ended.results.map(({ userId, rank, wpm, accuracy, timeMs }) => ({
            userId,
            rank,
            wpm,
            accuracy,
            timeMs,
          })),
        );
        this.server.to(info.roomId).emit(SOCKET_EVENTS.GAME_END, { results: ended.results });
      }
    }
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

    const result = this.gameService.recordFinish(
      info.roomId,
      info.userId,
      info.nickname,
      payload,
    );
    if (!result) return;

    this.server.to(info.roomId).emit(SOCKET_EVENTS.PLAYER_FINISHED, result);

    if (this.gameService.isGameOver(info.roomId)) {
      const ended = this.gameService.endGame(info.roomId);
      if (ended) {
        await this.roomsService.updateStatus(info.roomId, 'FINISHED');
        // DB 의 GameResult 모델은 nickname 컬럼이 없으므로 빼고 저장
        await this.roomsService.saveResults(
          info.roomId,
          ended.results.map(({ userId, rank, wpm, accuracy, timeMs }) => ({
            userId,
            rank,
            wpm,
            accuracy,
            timeMs,
          })),
        );
        this.server
          .to(info.roomId)
          .emit(SOCKET_EVENTS.GAME_END, { results: ended.results });
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
