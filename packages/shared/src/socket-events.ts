import type { GameResult, Player, Room } from './types';

// Client → Server 이벤트
export interface ClientToServerEvents {
  join_room: (payload: { roomId: string }) => void;
  leave_room: () => void;
  player_ready: () => void;
  typing_progress: (payload: { progress: number; wpm: number }) => void;
  typing_complete: (payload: { wpm: number; accuracy: number; timeMs: number }) => void;
}

// Server → Client 이벤트
export interface ServerToClientEvents {
  room_state: (room: Room) => void;
  game_starting: (payload: { countdown: number }) => void;
  game_start: (payload: { text: string }) => void;
  player_progress: (payload: { userId: string; progress: number; wpm: number }) => void;
  player_finished: (result: GameResult) => void;
  game_end: (payload: { results: GameResult[] }) => void;
  error: (payload: { message: string }) => void;
}

// 소켓 이벤트 이름 상수
export const SOCKET_EVENTS = {
  // C → S
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  PLAYER_READY: 'player_ready',
  TYPING_PROGRESS: 'typing_progress',
  TYPING_COMPLETE: 'typing_complete',
  // S → C
  ROOM_STATE: 'room_state',
  GAME_STARTING: 'game_starting',
  GAME_START: 'game_start',
  PLAYER_PROGRESS: 'player_progress',
  PLAYER_FINISHED: 'player_finished',
  GAME_END: 'game_end',
  ERROR: 'error',
} as const;
