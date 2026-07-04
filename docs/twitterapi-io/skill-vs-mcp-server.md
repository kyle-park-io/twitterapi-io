# `.agents/skills/twitterapi-io` (Skill) vs `twitterapi-io-mcp-server` (MCP)

두 가지 모두 twitterapi.io 공식 리소스지만, **배포 형태·프로토콜·범위**가 근본적으로 다르다. 이 문서는 이 저장소의 `.agents/skills/twitterapi-io/`(이하 "스킬", upstream: [`kaitoInfra/twitterapi-io`](https://github.com/kaitoInfra/twitterapi-io), `npx skills add kaitoInfra/twitterapi-io`로 설치)와 [`kaitoInfra/twitterapi-io-mcp-server`](https://github.com/kaitoInfra/twitterapi-io-mcp-server)(이하 "MCP 서버", npm `@twitterapi_io/mcp-server`, v0.2.0 기준)를 비교한다.

## 한 줄 요약

- **스킬** = Claude Code(또는 다른 에이전트 하네스)가 읽는 **마크다운 지식 문서**. 실행 코드가 없고, 에이전트가 이 문서를 참고해서 직접 `curl`/`requests`/`fetch`로 REST API를 호출하게 만든다.
- **MCP 서버** = 실제로 실행되는 **Node.js 프로세스**. MCP 프로토콜(JSON-RPC over stdio)로 12개의 고정된 read-only 툴을 제공하고, 에이전트는 그 툴만 호출한다.

## 아키텍처 차이

|                | 스킬 (`.agents/skills/twitterapi-io`)                           | MCP 서버 (`twitterapi-io-mcp-server`)                                                          |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 정체           | 마크다운 문서 4개 (`SKILL.md` + `references/*.md`)              | npm 패키지, TypeScript로 빌드된 실행 파일 (`build/index.js`)                                   |
| 실행 방식      | 없음 — 컨텍스트에 주입되는 텍스트일 뿐                          | `npx -y @twitterapi_io/mcp-server`로 별도 프로세스 기동, stdio로 MCP 클라이언트와 통신         |
| API 호출 주체  | **에이전트 자신**이 문서를 읽고 직접 HTTP 요청 코드를 생성/실행 | **서버 코드**가 `fetch()`로 요청을 대신 수행하고 결과만 에이전트에 반환                        |
| 프로토콜       | 없음 (그냥 지식)                                                | Model Context Protocol (spec 2025-11-25), `tools/list` + `tools/call`                          |
| 설치 필요 여부 | 불필요 — 저장소에 파일로 존재하면 끝                            | `npm install` / `npx` 필요, MCP 클라이언트 설정(`claude_desktop_config.json` 등)에 등록해야 함 |
| 의존성         | 없음                                                            | `@modelcontextprotocol/sdk`, `zod`                                                             |

## 커버리지 차이 (가장 중요한 차이)

MCP 서버 README에 명시된 대로, **읽기 전용 12개 툴**만 제공한다:

```
search_tweets, get_user_info, get_user_about, get_user_followers,
get_user_followings, get_user_last_tweets, get_user_mentions,
get_tweets_by_ids, get_tweet_replies, get_tweet_quotes,
get_tweet_retweeters, get_trends
```

그리고 README의 "What's NOT included" 섹션에서 **의도적으로 제외**한다고 밝힌 것들:

- ❌ 트윗 작성/좋아요/리트윗/팔로우/DM (쓰기 작업 전부)
- ❌ 계정 로그인 / 2FA
- ❌ 프로필/배너/아바타 수정
- ❌ 미디어 업로드
- ❌ 계정 삭제
- ❌ 실시간 스트림 / 웹훅 설정 ("MCP의 요청-응답 모델에 맞지 않는다"는 이유)

반면 이 저장소의 **스킬은 read + write 전부** 커버한다:

- Read: 위 12개 대응 기능 + `user/search`, `user/batch_info_by_ids`, `check_follow_relationship`, `article`, `spaces/detail`, `list/*`, `community/*`, `bulk_advanced_search`, `/oapi/my/info`(잔액) 등 훨씬 넓은 범위
- **Write**: `create_tweet_v2`, `delete_tweet_v2`, `like/unlike/retweet/bookmark`, `follow/unfollow`, `send_dm_to_user`, `update_profile_v2`, `update_avatar/banner_v2`, `upload_media_v2`, `create/join/leave/delete_community_v2`, `report_v2`, `list/add_member_v2`
- **로그인 플로우**: `user_login_v2` (`login_cookies` 발급)
- **실시간 모니터링**: `/oapi/x_user_stream/*` (사용자 모니터링), `/oapi/tweet_filter/*` (웹훅 필터 규칙)

즉 MCP 서버는 "안전한 자율 에이전트 사용"을 위해 범위를 최소화한 서브셋이고, 스킬은 twitterapi.io API 전체(쓰기 포함)를 대상으로 한다.

> **참고**: read-only인 것은 **MCP 프로토콜 자체의 제약이 아니라 이 서버(twitterapi.io 팀)의 설계 선택**이다. MCP는 그냥 에이전트가 외부 툴을 호출하는 표준 방식일 뿐이라, 서버 개발자가 원하면 쓰기 툴도 얼마든지 노출할 수 있다 (예: GitHub MCP 서버는 이슈/PR 생성, Slack MCP 서버는 메시지 전송을 지원). 이 twitterapi.io MCP 서버가 read-only인 것은 README에 명시된 대로 "자율 에이전트가 실수로 계정에 해를 끼치는 것을 막기 위한" 저자의 보수적 선택이다.

## 응답 처리 방식 차이

- **MCP 서버**: `src/transformer.ts`의 `compactResponse()`가 응답을 가로채서 불필요하게 중첩된 필드(작성자 전체 프로필, `extendedEntities`, 임베드된 리트윗 원본 등)를 제거하고 `{data:{tweets}}` → `{tweets}`로 평탄화한다. 목적은 명확히 문서화되어 있음: "20개 트윗 응답을 ~120KB → ~3KB로 줄여서 Claude.ai가 결과를 인라인으로 처리하고 `/mnt/user-data/`에 스풀하지 않도록 함." 즉 **LLM 컨텍스트 절약을 위한 자동 압축 레이어**가 존재.
- **스킬**: 원본 API 응답을 그대로 받게 되며, 대신 문서(`SKILL.md`, `endpoints.md`)에 "응답 스키마가 엔드포인트마다 다르다"는 경고와 4가지 envelope 패턴(`data`-wrapped / flat-with-envelope / flat-without-envelope / named-top-level-field)을 표로 정리해 에이전트가 방어적으로 파싱하도록 유도한다. 압축은 없다 — 페이로드 크기 문제는 전적으로 에이전트(코드 실행 시 직접 슬라이싱 등)에 맡겨진다.

## 파라미터 이름 문제를 다루는 방식

twitterapi.io REST API 자체가 엔드포인트마다 파라미터 케이스(`userName` vs `user_id` vs `username`)가 제각각이라는 동일한 근본 문제를 안고 있는데, 두 프로젝트는 이를 다른 층위에서 흡수한다:

- **MCP 서버**: `src/tools.ts`에서 [Zod](https://zod.dev)(TypeScript용 스키마 선언·검증 라이브러리) 스키마로 툴 하나당 파라미터를 고정 정의(`userName`, `tweetId`, `woeid` 등)하고, 내부적으로 올바른 실제 API 파라미터 이름/경로에 매핑한다. Zod 스키마는 두 가지 역할을 겸한다: (1) 런타임에 잘못된 입력(예: 범위를 벗어난 `pageSize`)을 호출 전에 거부하고, (2) 이 스키마가 JSON Schema로 변환되어 `tools/list`로 노출되므로 LLM이 각 파라미터의 타입·제약을 알 수 있다. 에이전트는 "무엇이 올바른 파라미터 이름인지" 신경 쓸 필요가 없다 — 스키마가 강제한다.
- **스킬**: 원본 REST API를 직접 치므로, 파라미터 케이싱 문제가 그대로 노출된다. 그래서 `SKILL.md`에 "Rule 1 — Parameter naming is per-endpoint"라는 규칙과 `endpoints.md`의 전체 표로 이를 문서화해서 에이전트가 실수하지 않도록 가이드한다. 이 자체가 스킬이 존재하는 핵심 이유 중 하나 — MCP 서버가 코드로 흡수한 복잡성을 스킬은 문서로 흡수한다.

## 에러 처리 / 재시도

- **MCP 서버**: `twitterapi-client.ts`에 하드코딩된 재시도 로직 — 429/5xx는 지수 백오프(1s/2s/4s, 최대 3회)로 자동 재시도, 30초 타임아웃, 4xx(429 제외)는 즉시 에러 반환. 이 동작은 고정되어 있고 에이전트가 바꿀 수 없다.
- **스킬**: `examples.md`에 재시도 로직이 담긴 예시 Python 클래스(`TwitterAPIIO._request`)를 제공하지만, 이는 "참고 코드"일 뿐 강제되지 않는다 — 에이전트가 그 코드를 그대로 실행할 수도, 무시하고 다르게 짤 수도 있다.

## 인증

- **MCP 서버**: `TWITTERAPI_IO_API_KEY` 환경 변수 → 서버 프로세스가 읽어서 `X-API-Key` 헤더로 전송. 이 키는 MCP 서버를 구동하는 클라이언트(Claude Desktop 등) 설정에 등록되고, 서버가 알아서 매 호출에 주입한다.
- **스킬**: `TWITTERAPI_IO_KEY` 환경 변수(이름 유사하지만 다름)를 **에이전트가 직접 읽어서** 요청 헤더에 넣도록 문서가 지시. 에이전트가 실행하는 코드에 키 사용 책임이 있다.

## 실시간 기능 처리 차이

MCP 서버는 README에서 실시간 스트림/웹훅을 "does not fit the MCP request/response model"이라며 명시적으로 제외했다. 반면 스킬은 정확히 이 갭을 메운다 — `/oapi/tweet_filter/*` (웹훅 필터 규칙 추가/조회/수정/삭제)와 `/oapi/x_user_stream/*` (사용자 모니터링 등록/조회/해제)를 전체 커버하며, "폴링 대신 필터 규칙 사용" 안티패턴까지 문서화되어 있다 (`SKILL.md` 마지막 줄: "Do not poll `/user/last_tweets` for real-time — use `/oapi/tweet_filter/add_rule` + webhook").

## 언제 무엇을 쓰나

- **MCP 서버가 적합한 경우**: Claude Desktop, Cursor, VS Code Copilot처럼 **코드를 직접 실행할 수 없는(혹은 안 시키고 싶은) 범용 챗 클라이언트**에서 읽기 전용 트위터 조회만 필요할 때. 설치가 표준화되어 있고, 쓰기 작업이 원천 차단되어 있어 안전.
- **스킬이 적합한 경우**: Claude Code처럼 **코드 실행이 가능한 에이전트 하네스**에서, 읽기뿐 아니라 게시/좋아요/팔로우/DM/프로필 수정 등 계정 작업과 실시간 모니터링까지 필요할 때. 이 저장소(`twitterapi-io`)의 CLI 예제들(`src/examples`)이 스킬 문서에 정리된 엔드포인트 지식을 실제 코드로 구현한 것.

## 결론

두 리소스는 경쟁 관계가 아니라 **같은 REST API를 서로 다른 배포 모델로 감싼 것**이다: MCP 서버는 "실행되는 안전한 서브셋 툴"이고, 스킬은 "에이전트가 코드를 짤 때 참고하는 전체 API 지식 베이스"다. 이 저장소는 코드 실행이 전제된 CLI 프로젝트이므로 스킬 쪽이 자연스러운 선택이며, 실제로 이 저장소의 예제 코드들이 스킬에 문서화된 엔드포인트 규칙(파라미터 케이싱, 응답 envelope, write body 필드 등)을 그대로 따르고 있다.
