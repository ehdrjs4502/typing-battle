import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';

@Module({
  imports: [AuthModule, RoomsModule, ConfigModule],
  providers: [GameGateway, GameService],
})
export class GameModule {}
