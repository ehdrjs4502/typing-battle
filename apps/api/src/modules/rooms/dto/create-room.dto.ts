import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  name: string;

  @IsInt()
  @Min(2)
  @Max(6)
  maxPlayers: number;
}
