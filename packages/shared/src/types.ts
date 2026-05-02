export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED';

export interface Player {
  id: string;
  nickname: string;
  isReady: boolean;
  isHost: boolean;
}

export interface Room {
  id: string;
  name: string;
  hostId: string;
  status: RoomStatus;
  maxPlayers: number;
  players: Player[];
  currentText?: string;
}

export interface GameResult {
  userId: string;
  nickname: string;
  rank: number;
  wpm: number;
  accuracy: number;
  timeMs: number;
  surrendered?: boolean;
}
