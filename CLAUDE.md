# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 사용자 컨텍스트

- 사용자는 **프론트엔드 개발자**이며, 백엔드 학습 목적으로 이 프로젝트의 Nest.js 서버를 직접 만들고 있습니다.
- 백엔드(Nest.js, Prisma, JWT, WebSocket Gateway, DI 컨테이너 등) 관련 작업을 할 때는 **무엇을 했는지뿐 아니라 왜 그렇게 하는지**를 함께 설명해 주세요. 데코레이터, 모듈/프로바이더 구조, 가드/필터 같은 Nest 특유의 개념은 짧게라도 짚어주는 편이 도움이 됩니다.
- 프론트엔드(Next.js App Router, React 19, Zustand, Tailwind v4) 쪽은 익숙하므로 과한 부연 설명은 생략해도 됩니다.
- 코드 주석과 에러 메시지는 한국어로 작성되어 있습니다. 새 코드도 같은 톤을 유지하세요.

## Repository Layout

Turborepo + pnpm workspace 모노레포입니다.

- `apps/web` — Next.js 16 (App Router, React 19, Tailwind v4, Zustand). 클라이언트.
- `apps/api` — Nest.js 11 + Prisma 6 + Socket.IO. 서버.
- `packages/shared` — 클라이언트/서버가 공유하는 타입과 소켓 이벤트 상수 (`@typing-battle/shared`). `tsc` 로 `dist/` 에 빌드되며 컨슈머는 컴파일된 결과를 import.

`apps/web/AGENTS.md`는 "이 Next.js는 breaking change가 있는 새 버전이니 코드 작성 전 `node_modules/next/dist/docs/` 의 가이드를 먼저 읽어라"고 명시합니다. Next.js 관련 작업 시 이 지시를 따르세요.

## Commands

루트에서 turbo로 모든 워크스페이스를 한 번에 실행합니다:

```bash
pnpm dev      # web + api 동시 실행 (turbo run dev)
pnpm build    # 전체 빌드
pnpm lint     # 전체 린트
```

개별 앱 명령은 해당 앱 디렉토리에서:

```bash
# apps/api
pnpm dev               # nest start --watch
pnpm test              # jest (단위)
pnpm test -- <pattern> # 특정 파일/패턴만
pnpm test:e2e          # test/jest-e2e.json 설정으로 e2e
pnpm test:cov          # 커버리지

# apps/web
pnpm dev               # next dev --port 3000
pnpm build             # next build
pnpm lint              # next lint
```

Prisma:

```bash
# apps/api 에서
pnpm exec prisma migrate dev --name <change>   # 마이그레이션 생성+적용 (개발)
pnpm exec prisma generate                      # 클라이언트 재생성 (postinstall에서도 자동 실행)
pnpm exec prisma studio                        # GUI
```

## 환경 변수

`apps/api`:
- `DATABASE_URL` — PostgreSQL 연결 문자열 (Prisma)
- `JWT_SECRET` — 필수. `getOrThrow`로 읽으므로 없으면 부팅 실패
- `PORT` — 기본 3001
- `FRONTEND_URL` — CORS origin (기본 `http://localhost:3000`)

`apps/web`:
- `NEXT_PUBLIC_API_URL` — REST 호출과 소켓 연결 모두에서 사용

기본 포트: **web 3000 / api 3001**. `NEXT_PUBLIC_API_URL` 미설정 시 fallback도 `localhost:3001` 을 가리킵니다.

다만 [apps/web/lib/api.ts](apps/web/lib/api.ts) 의 REST fallback은 `http://localhost:3001/api` (경로 포함), [apps/web/lib/socket.ts](apps/web/lib/socket.ts) 의 소켓 fallback은 `http://localhost:3001` (호스트만, 뒤에 `/game` 네임스페이스 붙임) 입니다. 즉 **둘이 같은 환경변수를 다른 의미로 쓰고 있어서**, `NEXT_PUBLIC_API_URL` 을 명시할 때는 한쪽 형식으로 통일하면 다른 쪽이 깨집니다 — 추후 정리 필요. 지금은 환경변수 없이 fallback 만 쓰면 양쪽 다 정상 동작합니다.

## 아키텍처 개요

### 인증 흐름 (REST + WebSocket 동일 토큰)

1. 클라이언트가 `POST /api/auth/register` 또는 `/login` 으로 JWT(`access_token`)를 받음 → `localStorage.token`, `nickname` 저장 ([store/auth.ts](apps/web/store/auth.ts)).
2. **REST 요청**: `lib/api.ts` 의 `request()` 가 `Authorization: Bearer <token>` 헤더 자동 첨부. 서버에서는 `JwtAuthGuard` (Passport `JwtStrategy`) 가 검증.
3. **WebSocket 요청**: `socket.io-client` 가 `auth: { token }` 으로 핸드셰이크. 서버에서는 `WsJwtGuard` 가 `client.handshake.auth.token` 을 직접 검증해서 `client.data.user` 에 payload(`{ sub, nickname, ... }`)를 심어둠. 이후 게이트웨이 핸들러에서 이 값을 읽어 사용 ([modules/game/game.gateway.ts](apps/api/src/modules/game/game.gateway.ts#L50)).

`JwtAuthGuard` 는 HTTP용, `WsJwtGuard` 는 WS용으로 별개입니다 — Nest 의 `ExecutionContext` 가 HTTP/WS 둘 다 처리할 수 있지만, 토큰 추출 위치와 예외 종류가 달라서 가드를 분리해 두었습니다.

### Nest.js 모듈 구조

[apps/api/src/app.module.ts](apps/api/src/app.module.ts) 에서 다음 모듈들을 import 합니다:

- `PrismaModule` — `PrismaService` 단일 프로바이더. `OnModuleInit` 에서 `$connect`. 다른 모듈은 이걸 import 해서 DB 접근.
- `UsersModule` — 사용자 CRUD. `AuthModule` 이 의존.
- `AuthModule` — `AuthController`(REST), `AuthService`, `JwtStrategy`. `JwtModule.registerAsync` 로 `JWT_SECRET` 주입. **`exports: [JwtModule]`** — 다른 모듈(예: `GameModule` 의 `WsJwtGuard`) 이 `JwtService` 를 쓰려면 이 export 가 필수입니다.
- `RoomsModule` — 방 CRUD (REST). DB 영속 데이터.
- `GameModule` — `GameGateway`(Socket.IO) + `GameService`. 게임 진행 중 상태는 **인메모리** (`Map<roomId, Room>`). `RoomsService` 도 import 해서 방장 검증, 상태 업데이트 시 DB와 동기화.

### REST vs WebSocket 역할 분리

- **REST** (`/api/auth/*`, `/api/rooms`): 회원가입/로그인, 방 목록/생성/조회 등 영속 작업. `Controller` + `Service` + Prisma.
- **WebSocket** (`/game` 네임스페이스): 실시간 게임 진행. `WebSocketGateway` 데코레이터로 선언, `@SubscribeMessage(...)` 로 핸들러 정의. 모든 이벤트 이름은 [packages/shared/src/socket-events.ts](packages/shared/src/socket-events.ts) 의 `SOCKET_EVENTS` 상수로 정의 — **클라이언트/서버가 같은 상수를 import** 합니다. 새 이벤트 추가 시 여기에 먼저 정의 + `ClientToServerEvents`/`ServerToClientEvents` 인터페이스를 갱신하세요.

### 게임 라이프사이클 (Gateway 흐름)

[apps/api/src/modules/game/game.gateway.ts](apps/api/src/modules/game/game.gateway.ts) + [game.service.ts](apps/api/src/modules/game/game.service.ts):

1. `join_room` → DB에서 Room 검증 → `GameService.getOrCreateRoom` 으로 인메모리 room 생성 → `socket.join(roomId)` + `socketMap` 에 `socketId → {userId, nickname, roomId}` 기록 → `room_state` 브로드캐스트.
2. `player_ready` → `isReady=true` → `room_state` 브로드캐스트.
3. `start_game` (방장만) → 3초 카운트다운 (`game_starting`) → `GAME_START` 와 함께 랜덤 텍스트 전송, DB 상태 `PLAYING`.
4. `typing_progress` → 같은 방 다른 클라이언트들에게 `player_progress` 중계 (본인 제외).
5. `typing_complete` → `recordFinish` 로 등수 기록 → `player_finished` 브로드캐스트 → 모든 플레이어 완료 시 `game_end` + DB 상태 `FINISHED` + 인메모리 정리.
6. `disconnect` → `socketMap` 으로 어떤 방의 누구였는지 찾아 `removePlayer` (방장이면 다음 사람에게 위임, 빈 방이면 삭제).

핵심 패턴: **`socketMap` 으로 socket 단위 컨텍스트를 추적** + **`server.to(roomId).emit(...)` 로 방 단위 브로드캐스트**. 이는 Socket.IO 의 room 기능을 활용한 표준 패턴입니다.

### 인메모리 vs 영속 상태

- DB(`Room`, `User`, `GameResult`): "방이 존재한다" 같은 영속 정보.
- 인메모리(`GameService.rooms`, `finishOrder`): "지금 방에 누가 들어와 있고 누가 준비됐고 몇 등으로 끝났는지" 같은 휘발성 게임 진행 상태.

서버를 재시작하면 인메모리 상태는 사라지고 DB의 `RoomStatus` 만 남으므로, 재시작 시점에 `PLAYING` 상태로 박제될 수 있습니다 (현재는 정리 로직 없음). 수평 확장을 하려면 이 인메모리 부분을 Redis 등으로 옮겨야 합니다.

### 공유 타입 패키지

`packages/shared` 는 `tsc` 로 `dist/` 에 CommonJS + `.d.ts` 를 빌드합니다. `package.json` 의 `main`/`types`/`exports` 가 모두 `./dist/...` 를 가리킵니다. 처음에는 무빌드로 `./src/index.ts` 를 직접 export 했지만, Node 22 의 native TS 로더가 ESM 해석 시 상대 경로에 명시적 확장자(`.ts`)를 요구해서 런타임 에러가 났고, TS 의 `allowImportingTsExtensions` 는 `noEmit` 과 충돌해 양립이 어려웠습니다. 그래서 표준적인 빌드 단계를 두는 쪽으로 정리했습니다.

`turbo.json` 의 `dev` 태스크가 `dependsOn: ["^build"]` 라서 `pnpm dev` 시 shared 가 먼저 한 번 빌드된 뒤 api/web 의 watch 가 시작됩니다. shared 의 타입을 수정한 경우엔 `pnpm --filter @typing-battle/shared build` 를 다시 돌려야 api/web 이 변경을 봅니다.

## 자주 헷갈리는 Nest.js 개념 (백엔드 학습 메모)

- **`@Module({ imports, providers, controllers, exports })`** — 한 모듈이 다른 모듈의 프로바이더를 쓰려면, 제공하는 쪽 모듈이 `exports` 에 넣어야 하고 쓰는 쪽이 `imports` 해야 합니다.
- **DI 생성자 주입** — `constructor(private foo: FooService)` 라고만 쓰면 Nest 가 자동으로 `FooService` 인스턴스를 넣어줍니다 (싱글톤이 기본).
- **Guard vs Filter vs Pipe** — Guard: 요청 통과/차단(인증/인가). Pipe: 입력 변환/검증(`ValidationPipe`). Filter: 예외를 응답으로 변환(`WsExceptionFilter`).
- **`@SubscribeMessage` 핸들러는 throw 한 `WsException` 만 클라이언트에 `error` 이벤트로 전달됩니다** — 일반 `Error` 를 throw 하면 Socket.IO 가 끊기거나 무시할 수 있어요. 그래서 `WsExceptionFilter` 가 필요합니다.
- **Prisma**: `schema.prisma` 가 단일 진실 소스. 모델을 바꿨으면 `prisma migrate dev` 로 마이그레이션을 생성/적용해야 하고, `prisma generate` 로 타입 클라이언트를 재생성해야 합니다 (이 레포에선 `postinstall` 에서 자동).
