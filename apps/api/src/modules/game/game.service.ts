import { Injectable } from '@nestjs/common';
import { Player, Room } from '@typing-battle/shared';
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
  private finishOrder = new Map<string, string[]>(); // roomId → userId[]

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
    this.finishOrder.set(roomId, []);
    const text = TEXTS[Math.floor(Math.random() * TEXTS.length)];
    return { room, text };
  }

  recordFinish(roomId: string, userId: string): number {
    const order = this.finishOrder.get(roomId) ?? [];
    if (!order.includes(userId)) order.push(userId);
    this.finishOrder.set(roomId, order);
    return order.length; // rank
  }

  isGameOver(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    const order = this.finishOrder.get(roomId) ?? [];
    if (!room) return false;
    return order.length >= room.players.length;
  }

  endGame(roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.status = 'FINISHED';
    this.rooms.delete(roomId);
    this.finishOrder.delete(roomId);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }
}
