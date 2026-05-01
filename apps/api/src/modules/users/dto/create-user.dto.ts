import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(12)
  nickname: string;

  @IsString()
  @MinLength(8)
  password: string;
}
