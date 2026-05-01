import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async create(hostId: string, dto: CreateRoomDto) {
    return this.prisma.room.create({
      data: { name: dto.name, maxPlayers: dto.maxPlayers, hostId },
    });
  }

  async findAll() {
    return this.prisma.room.findMany({
      where: { status: { in: ['WAITING', 'PLAYING'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('방을 찾을 수 없습니다.');
    return room;
  }

  async updateStatus(id: string, status: 'WAITING' | 'PLAYING' | 'FINISHED') {
    return this.prisma.room.update({ where: { id }, data: { status } });
  }

  async saveResults(
    roomId: string,
    results: { userId: string; rank: number; wpm: number; accuracy: number; timeMs: number }[],
  ) {
    return this.prisma.gameResult.createMany({ data: results.map((r) => ({ ...r, roomId })) });
  }
}
