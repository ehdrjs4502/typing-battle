# Nest.js 핵심 개념 정리

> **이 프로젝트(typing-battle)** 의 실제 코드를 기반으로 Nest.js의 핵심 개념을 정리합니다.

---

## 목차

1. [앱 부트스트랩](#1-앱-부트스트랩)
2. [모듈 시스템](#2-모듈-시스템)
3. [의존성 주입 (DI)](#3-의존성-주입-di)
4. [컨트롤러 & 라우팅](#4-컨트롤러--라우팅)
5. [서비스](#5-서비스)
6. [DTO & 유효성 검사 (Pipe)](#6-dto--유효성-검사-pipe)
7. [Guard (인증/인가)](#7-guard-인증인가)
8. [Exception Filter (예외 처리)](#8-exception-filter-예외-처리)
9. [커스텀 파라미터 데코레이터](#9-커스텀-파라미터-데코레이터)
10. [Passport + JWT 전략](#10-passport--jwt-전략)
11. [WebSocket Gateway](#11-websocket-gateway)
12. [Prisma & 라이프사이클 훅](#12-prisma--라이프사이클-훅)
13. [인메모리 vs 영속 상태 패턴](#13-인메모리-vs-영속-상태-패턴)
14. [ExecutionContext — HTTP와 WS 분기](#14-executioncontext--http와-ws-분기)

---

## 1. 앱 부트스트랩

> **파일**: `apps/api/src/main.ts`

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');                              // 모든 REST 경로 앞에 /api 붙임
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
```

### 핵심 포인트

| 옵션 | 의미 |
|------|------|
| `whitelist: true` | DTO에 정의되지 않은 프로퍼티를 자동으로 제거 |
| `transform: true` | 쿼리 파라미터/JSON을 DTO 타입으로 자동 변환 (`"3"` → `3`) |
| `setGlobalPrefix('api')` | 컨트롤러마다 `/api` 를 붙이지 않아도 됨 |

`useGlobalPipes`는 **모든 컨트롤러에** 파이프를 적용합니다. 특정 컨트롤러/핸들러에만 적용하려면 `@UsePipes(...)` 데코레이터를 씁니다.

---

## 2. 모듈 시스템

> **파일**: `apps/api/src/app.module.ts`, `auth.module.ts`

Nest.js는 기능 단위로 **모듈**을 나누고, 루트 모듈이 이들을 조립합니다.

```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),  // 전역 모듈 — 어디서든 ConfigService 주입 가능
    PrismaModule,
    UsersModule,
    AuthModule,
    RoomsModule,
    GameModule,
  ],
})
export class AppModule {}
```

### `@Module` 4가지 속성

```
@Module({
  imports:     다른 모듈을 가져옴. 그 모듈이 exports 한 프로바이더를 내 모듈에서 쓸 수 있게 됨
  providers:   이 모듈 안에서 DI 컨테이너에 등록할 클래스 (Service, Guard, Strategy 등)
  controllers: HTTP/WS 요청을 받는 클래스
  exports:     다른 모듈이 imports 했을 때 꺼내 쓸 수 있는 프로바이더 목록
})
```

### exports가 왜 필요한가?

```ts
// auth.module.ts
@Module({
  imports: [JwtModule.registerAsync(...)],
  exports: [JwtModule],  // ← 이게 없으면 GameModule 에서 JwtService 를 주입받을 수 없음
})
export class AuthModule {}

// game.module.ts
@Module({
  imports: [AuthModule],  // AuthModule 이 export 한 JwtModule 을 통해 JwtService 접근 가능
  providers: [WsJwtGuard, ...],
})
export class GameModule {}
```

**규칙**: 모듈 A가 제공하는 프로바이더를 모듈 B에서 쓰려면  
→ 모듈 A가 `exports`에 넣어야 하고  
→ 모듈 B가 `imports`에 모듈 A를 넣어야 합니다.

### 동적 모듈 (Dynamic Module)

```ts
JwtModule.registerAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow('JWT_SECRET'),
    signOptions: { expiresIn: '7d' },
  }),
})
```

`forRoot` / `register` / `registerAsync` 패턴은 외부 라이브러리 모듈을 **설정값과 함께** 초기화할 때 씁니다.  
`Async` 접미사는 환경 변수처럼 **비동기적으로 로드해야 하는 값**을 `useFactory`로 넘길 수 있게 해줍니다.

---

## 3. 의존성 주입 (DI)

Nest.js는 **IoC 컨테이너**를 내장합니다. `@Injectable()` 이 붙은 클래스는 컨테이너에 등록되고, 생성자에서 선언만 하면 자동으로 인스턴스를 받습니다.

```ts
@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,  // 컨테이너가 알아서 넣어줌
    private jwtService: JwtService,
  ) {}
}
```

- 기본 스코프는 **싱글톤** — 앱 전체에서 하나의 인스턴스를 공유합니다.
- `private`을 생성자 파라미터에 붙이면 TypeScript가 자동으로 `this.usersService = usersService` 를 해줍니다 (파라미터 프로퍼티 단축 문법).

---

## 4. 컨트롤러 & 라우팅

> **파일**: `apps/api/src/modules/rooms/rooms.controller.ts`

```ts
@Controller('rooms')          // 기본 경로: /api/rooms
@UseGuards(JwtAuthGuard)      // 컨트롤러 전체에 가드 적용
export class RoomsController {
  constructor(private roomsService: RoomsService) {}

  @Post()                                   // POST /api/rooms
  create(
    @CurrentUser() user: { id: string },    // 커스텀 파라미터 데코레이터
    @Body() dto: CreateRoomDto,             // 요청 body
  ) {
    return this.roomsService.create(user.id, dto);
  }

  @Get()                                    // GET /api/rooms
  findAll() { ... }

  @Get(':id')                               // GET /api/rooms/:id
  findOne(@Param('id') id: string) { ... }
}
```

### 주요 파라미터 데코레이터

| 데코레이터 | 추출 대상 |
|-----------|----------|
| `@Body()` | `req.body` |
| `@Param('id')` | `req.params.id` |
| `@Query('page')` | `req.query.page` |
| `@Headers('auth')` | `req.headers.auth` |
| `@CurrentUser()` | 커스텀 (아래 섹션 참고) |

---

## 5. 서비스

> **파일**: `apps/api/src/modules/auth/auth.service.ts`

서비스는 **비즈니스 로직**을 담당합니다. 컨트롤러는 요청/응답을 처리하고, 실제 작업은 서비스에 위임합니다.

```ts
@Injectable()
export class AuthService {
  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) throw new UnauthorizedException('...');

    return this.signToken(user.id, user.email, user.nickname);
  }

  private signToken(sub: string, email: string, nickname: string) {
    const payload: JwtPayload = { sub, email, nickname };
    return { access_token: this.jwtService.sign(payload) };
  }
}
```

**HTTP 예외 클래스**는 Nest가 자동으로 알맞은 HTTP 상태 코드로 변환합니다:

| 클래스 | 상태 코드 |
|--------|----------|
| `NotFoundException` | 404 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `BadRequestException` | 400 |
| `ConflictException` | 409 |

---

## 6. DTO & 유효성 검사 (Pipe)

> **파일**: `apps/api/src/modules/users/dto/create-user.dto.ts`

**DTO (Data Transfer Object)** 는 요청 데이터의 모양을 정의하고, `class-validator` 데코레이터로 유효성 규칙을 선언합니다.

```ts
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
```

`ValidationPipe`가 글로벌로 등록되어 있으면(`main.ts`), 컨트롤러가 `@Body() dto: CreateUserDto` 를 받을 때 자동으로 유효성 검사가 실행됩니다. 실패하면 400 Bad Request를 자동으로 반환합니다.

### Pipe의 역할

```
요청 → Guard → Pipe → Handler
              ↑
              여기서 변환(transform) + 검증(validate) 수행
```

---

## 7. Guard (인증/인가)

Guard는 요청을 **통과시킬지 차단할지** 결정합니다. `canActivate()`가 `true`를 반환하면 다음으로 진행, `false`면 403.

### HTTP Guard (Passport 방식)

> **파일**: `apps/api/src/common/guards/jwt-auth.guard.ts`, `jwt.strategy.ts`

```ts
// Guard는 단 한 줄 — 실제 로직은 Strategy 에 있음
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

```ts
// 실제 JWT 검증 로직
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService, private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // 여기서 반환한 값이 request.user 에 들어감
    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

Passport 패턴: `AuthGuard('jwt')` 가 `JwtStrategy.validate()` 를 호출 → 반환값이 `request.user`가 됩니다.

### WebSocket Guard (직접 구현 방식)

> **파일**: `apps/api/src/common/guards/ws-jwt.guard.ts`

```ts
@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();
    const token = client.handshake.auth?.token;  // 클라이언트가 handshake 시 전달

    if (!token) throw new UnauthorizedException('WebSocket: 토큰이 없습니다.');

    const payload = this.jwtService.verify(token, { secret: '...' });
    client.data.user = payload;  // 이후 핸들러에서 client.data.user 로 꺼내 씀
    return true;
  }
}
```

HTTP Guard와 WS Guard를 **분리한 이유**:
- HTTP: `request.headers.authorization`에서 토큰 추출, `HttpException` 던짐
- WS: `client.handshake.auth.token`에서 추출, `WsException` 던짐
- 토큰 위치와 예외 종류가 달라서 `ExecutionContext` 분기보다 클래스 분리가 더 명확합니다.

---

## 8. Exception Filter (예외 처리)

> **파일**: `apps/api/src/common/filters/ws-exception.filter.ts`

`@Catch()` 로 잡을 예외를 지정하고, `catch()` 메서드에서 처리합니다.

```ts
@Catch(WsException, HttpException)          // 이 두 타입을 잡음
export class WsExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: WsException | HttpException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient();
    const message =
      exception instanceof WsException
        ? exception.getError()
        : exception.message;
    client.emit('error', { message });      // 클라이언트에게 error 이벤트 전송
  }
}
```

게이트웨이 클래스에 `@UseFilters(WsExceptionFilter)` 를 붙이면 해당 게이트웨이 전체에 적용됩니다.

> **왜 WS에서는 Filter가 필수인가?**  
> `@SubscribeMessage` 핸들러에서 일반 `Error`를 던지면 Socket.IO가 조용히 무시하거나 연결을 끊습니다.  
> `WsException`을 던지고 Filter가 이를 잡아 `error` 이벤트로 변환해야 클라이언트가 받을 수 있습니다.

---

## 9. 커스텀 파라미터 데코레이터

> **파일**: `apps/api/src/common/decorators/current-user.decorator.ts`

```ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;  // JwtStrategy.validate() 가 반환한 user 객체
  },
);
```

사용:
```ts
@Get()
findAll(@CurrentUser() user: { id: string }) {
  // user.id 로 바로 접근 가능
}
```

`@Param('id')`, `@Body()` 처럼 핸들러 파라미터에서 원하는 값을 꺼내는 **나만의 데코레이터**를 만들 수 있습니다. `createParamDecorator` 첫 번째 인자는 `@CurrentUser('nickname')` 처럼 데코레이터에 값을 전달할 때 `_data`로 들어옵니다.

---

## 10. Passport + JWT 전략

전체 흐름:

```
클라이언트                           서버
   │                                  │
   │  POST /api/auth/login            │
   │ ─────────────────────────────→  │
   │                             AuthController
   │                             AuthService.login()
   │                             bcrypt.compare()
   │                             JwtService.sign(payload)
   │  { access_token: "eyJ..." }      │
   │ ←─────────────────────────────  │
   │                                  │
   │  GET /api/rooms                  │
   │  Authorization: Bearer eyJ...   │
   │ ─────────────────────────────→  │
   │                             JwtAuthGuard
   │                             JwtStrategy.validate()
   │                             → request.user = { id, email, nickname }
   │                             RoomsController.findAll()
   │  [{ id, name, ... }, ...]        │
   │ ←─────────────────────────────  │
```

JWT payload(`sub`, `email`, `nickname`)는 `JwtPayload` 인터페이스로 타입을 공유합니다.  
`sub`는 JWT 표준 클레임으로 "subject" — 여기서는 `userId`를 담습니다.

---

## 11. WebSocket Gateway

> **파일**: `apps/api/src/modules/game/game.gateway.ts`

### 선언

```ts
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/game' })
@UseFilters(WsExceptionFilter)      // 클래스 전체에 예외 필터 적용
export class GameGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;                   // Socket.IO Server 인스턴스 자동 주입

  constructor(
    private gameService: GameService,
    private roomsService: RoomsService,
  ) {}
```

### 이벤트 핸들러

```ts
@UseGuards(WsJwtGuard)
@SubscribeMessage(SOCKET_EVENTS.JOIN_ROOM)        // 클라이언트가 보내는 이벤트 이름
async handleJoinRoom(
  @ConnectedSocket() client: Socket,              // 이 연결의 소켓
  @MessageBody() payload: { roomId: string },     // 이벤트와 함께 온 데이터
) {
  const user: JwtPayload = client.data.user;      // WsJwtGuard 가 심어둔 유저 정보
  // ...
  this.server.to(roomId).emit(SOCKET_EVENTS.ROOM_STATE, room);  // 방 전체 브로드캐스트
}
```

### 브로드캐스트 방법 비교

| 코드 | 대상 |
|------|------|
| `client.emit(event, data)` | 이 소켓(본인)에게만 |
| `client.to(roomId).emit(...)` | 같은 방, 본인 **제외** |
| `this.server.to(roomId).emit(...)` | 같은 방 **전원** (본인 포함) |
| `this.server.emit(...)` | 서버에 연결된 **모든** 소켓 |

### 연결 해제 처리

```ts
// OnGatewayDisconnect 인터페이스를 implements 하면 자동 호출
async handleDisconnect(client: Socket) {
  const info = this.socketMap.get(client.id);
  if (!info) return;
  // 방에서 플레이어 제거, 빈 방이면 DB에서도 삭제
}
```

`OnGatewayConnect` (연결 시), `OnGatewayDisconnect` (연결 해제 시), `OnGatewayInit` (서버 초기화 시) 인터페이스를 통해 라이프사이클 이벤트를 처리합니다.

### 소켓 맵 패턴

```ts
// socketId → { userId, nickname, roomId }
private socketMap = new Map<string, { userId: string; nickname: string; roomId: string }>();
```

Socket.IO는 `socket.id`(연결 단위)는 알지만 "이 소켓이 누구인지"는 모릅니다.  
`socketMap`으로 `socketId → 유저 정보`를 직접 관리해서, disconnect 시 "어느 방의 누가 나갔는지"를 추적합니다.

---

## 12. Prisma & 라이프사이클 훅

> **파일**: `apps/api/src/prisma/prisma.service.ts`

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();   // 모듈이 초기화될 때 DB 연결
  }
}
```

`OnModuleInit`은 Nest.js의 **라이프사이클 훅** 중 하나입니다:

| 훅 | 호출 시점 |
|----|----------|
| `OnModuleInit` | 모듈의 의존성이 모두 해결된 직후 |
| `OnModuleDestroy` | 모듈이 종료되기 직전 |
| `OnApplicationShutdown` | 앱 종료 시그널을 받았을 때 |

`PrismaService`는 `PrismaModule`에서 `global: true` 없이 선언되어 있지만, `AppModule`에서 `PrismaModule`을 import하므로 다른 모든 모듈에서 사용할 수 있습니다 (exports에 등록되어 있기 때문).

---

## 13. 인메모리 vs 영속 상태 패턴

> **파일**: `apps/api/src/modules/game/game.service.ts`

이 프로젝트는 게임 상태를 두 계층으로 나눠서 관리합니다.

```
DB (PostgreSQL / Prisma)               인메모리 (GameService)
─────────────────────────────          ──────────────────────────────
방이 존재하는가 (Room 테이블)           현재 방에 누가 들어와 있는가
게임 결과 (GameResult 테이블)           누가 준비됐는가
                                        현재 타이핑 텍스트는 무엇인가
                                        몇 등까지 완주했는가
```

```ts
@Injectable()
export class GameService {
  private rooms = new Map<string, Room>();           // 게임 진행 중 방 상태
  private results = new Map<string, GameResult[]>(); // 완주 순서 누적

  // DB 없이 순수하게 메모리에서 작동
  // → 서버 재시작 시 모든 게임 상태 소멸
}
```

**장점**: DB 왕복 없이 빠른 실시간 업데이트  
**단점**: 서버 재시작 시 상태 소멸, 수평 확장 불가 (여러 서버 인스턴스 간 공유 안 됨)  
**수평 확장 시**: 인메모리 Map을 Redis로 교체해야 합니다.

---

## 14. ExecutionContext — HTTP와 WS 분기

`ExecutionContext`는 Guard, Filter, Interceptor에서 **현재 요청이 어떤 프로토콜인지**에 따라 분기할 수 있게 해줍니다.

```ts
// HTTP Guard
const request = context.switchToHttp().getRequest();
const user = request.user;

// WebSocket Guard
const client: Socket = context.switchToWs().getClient();
const token = client.handshake.auth?.token;
```

같은 `ExecutionContext` 객체지만 `.switchToHttp()` / `.switchToWs()` / `.switchToRpc()` 로 컨텍스트를 전환합니다.  
이 프로젝트에서는 HTTP와 WS 가드를 **클래스 자체를 분리**해서 단일 책임을 유지했습니다.

---

## 요약: 요청 처리 흐름

### REST 요청

```
요청 → (미들웨어) → Guard → Pipe → Controller → Service → Prisma → DB
                 ↑ JwtAuthGuard  ↑ ValidationPipe
```

### WebSocket 이벤트

```
이벤트 → Guard → Filter → Gateway Handler → Service → (Prisma)
        ↑ WsJwtGuard   ↑ WsExceptionFilter
```

### 핵심 구성 요소 역할 한 줄 요약

| 구성 요소 | 역할 |
|----------|------|
| **Module** | 기능 단위 캡슐화, 의존성 선언 |
| **Controller** | HTTP 경로 매핑, 요청/응답 위임 |
| **Service** | 비즈니스 로직, DB 접근 |
| **Guard** | 요청 통과/차단 (인증/인가) |
| **Pipe** | 입력 변환 및 유효성 검사 |
| **Filter** | 예외를 응답 형태로 변환 |
| **Decorator** | 파라미터 추출 로직 재사용 |
| **Gateway** | WebSocket 이벤트 핸들링 |
| **Strategy** | Passport 인증 방법 정의 |
