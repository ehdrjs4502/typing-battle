import { Injectable } from '@nestjs/common';
import { GameResult, Player, Room } from '@typing-battle/shared';
import { RoomsService } from '../rooms/rooms.service';

const TEXTS = [
  'The quick brown fox jumps over the lazy dog and runs through the forest at full speed.',
  'Programming is the art of telling another human what one wants the computer to do.',
  'Any sufficiently advanced technology is indistinguishable from magic.',
  'First solve the problem then write the code to solve it.',
  'The best code is no code at all every new line is a debt you take on.',
];

@Injectable()
export class GameService {
  // 인메모리 방 상태 (게임 진행 중 데이터)
  private rooms = new Map<string, Room>();
  // roomId → 완주한 플레이어 결과 배열 (push 순서 == 등수)
  private results = new Map<string, GameResult[]>();

  constructor(private roomsService: RoomsService) {}

  getOrCreateRoom(roomId: string, hostId: string, roomName: string, maxPlayers: number): Room {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        name: roomName,
        hostId,
        status: 'WAITING',
        maxPlayers,
        players: [],
      });
    }
    return this.rooms.get(roomId)!;
  }

  addPlayer(roomId: string, player: Player): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!room.players.find((p) => p.id === player.id)) {
      room.players.push(player);
    }
    return room;
  }

  removePlayer(roomId: string, userId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.players = room.players.filter((p) => p.id !== userId);
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      return null;
    }
    // 방장이 나가면 다음 플레이어가 방장
    if (room.hostId === userId && room.players.length > 0) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }
    return room;
  }

  setPlayerReady(roomId: string, userId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find((p) => p.id === userId);
    if (player) player.isReady = true;
    return room;
  }

  canStart(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.players.length < 2) return false;
    return room.players.every((p) => p.isReady || p.isHost);
  }

  startGame(roomId: string): { room: Room; text: string } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.status = 'PLAYING';
    this.results.set(roomId, []);
    const text = TEXTS[Math.floor(Math.random() * TEXTS.length)];
    return { room, text };
  }

  recordFinish(
    roomId: string,
    userId: string,
    nickname: string,
    stats: { wpm: number; accuracy: number; timeMs: number },
  ): GameResult | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const list = this.results.get(roomId) ?? [];
    // 중복 호출 방어 (typing_complete 가 두 번 들어와도 등수 꼬이지 않도록)
    const existing = list.find((r) => r.userId === userId);
    if (existing) return existing;

    const result: GameResult = {
      userId,
      nickname,
      rank: list.length + 1,
      ...stats,
    };
    list.push(result);
    this.results.set(roomId, list);
    return result;
  }

  isGameOver(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    const list = this.results.get(roomId) ?? [];
    if (!room) return false;
    return list.length >= room.players.length;
  }

  endGame(roomId: string): { room: Room; results: GameResult[] } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.status = 'FINISHED';
    const results = this.results.get(roomId) ?? [];
    this.rooms.delete(roomId);
    this.results.delete(roomId);
    return { room, results };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }
}
