# 팔로우 / 언팔로우 한도 조사 (2026-09-02)

> **목적:** 기존 팔로우 정리(스팸·스캠 언팔로우) + 양질 계정 신규 팔로우 작업에 들어가기 전,
> "시간당·하루당 몇 명까지 안전한가"를 확정한다.
> **결론 요약:** 숫자 한도보다 **행동 패턴(churn) 규칙**이 더 빡빡한 제약이고,
> 지금 우리 실행 경로(Playwright 브라우저)엔 **`unfollow()`가 구현돼 있지 않다.**

---

## 1. TL;DR

| 질문                        | 답                                                                          |
| --------------------------- | --------------------------------------------------------------------------- |
| 팔로우 하루 한도            | **400/일** (X 공식, 전 계정 공통). "Premium은 1,000"은 **비공식 속설**       |
| 언팔로우 하루 한도          | **X가 공식 수치를 발표한 적 없음.** 서드파티 컨센서스는 팔로우와 동일 취급   |
| 시간당 한도                 | **공식 수치 없음.** 존재는 확인됨 ("너무 빨리 팔로우했다, 1시간 뒤 재시도")  |
| 우리 계정 실측 안전 레이트  | **13.7팔로우/시간 · 329/일 · 23일 연속** → 스팸 정지 없었음 (ratio cap만 걸림) |
| 진짜 위험                   | 숫자가 아니라 **follow churn** — X가 명시적으로 금지, 정지 사유              |
| 지금 언팔 가능한가          | **아니오.** 우리 경로(Playwright)에 `unfollow()`가 미구현 — 추가하면 됨      |

---

## 2. X 공식 한도 (원문 인용)

출처: [About X limits](https://help.x.com/en/rules-and-policies/x-limits), [About following on X](https://help.x.com/en/using-x/x-follow-limit)

> **Following (daily):** The technical follow limit is **400 per day**. Please note that this is a
> **technical account limit only**, and there are additional rules prohibiting aggressive
> following behavior.
>
> **Following (account-based):** Once an account is following **5,000** other accounts, additional
> follow attempts are limited by **account-specific ratios**.

그리고 "더 이상 팔로우할 수 없습니다" 메시지의 4가지 원인:

> - You've reached the **daily follow limit**. You can follow more accounts after a day has passed.
> - You've followed **too many accounts too quickly**. Try again in **an hour or so**.
> - You've hit a **follow ratio limit**. You can try again once your account has more followers,
>   **or you can unfollow a few accounts to follow new ones**.
> - Your account is **locked or limited** … including due to aggressive follow behavior.

### 여기서 확인된 사실 3가지

1. **하루 400** — Premium 여부와 무관하게 공식 문서는 400 하나만 말한다. 검색에 흔한
   "인증 계정은 1,000"은 X 문서에 근거가 없다. 400을 기준선으로 잡는 게 맞다.
2. **시간 단위 소프트 한도가 존재한다** — "too many too quickly … try again in an hour or so".
   수치는 비공개. 즉 **일일 한도를 안 넘겨도 시간당 몰아치면 막힌다.**
3. **언팔로우 한도는 X 문서 어디에도 없다.** 공식 수치가 없다는 게 "무제한"이라는 뜻은 아니고,
   내부 스팸 시스템이 별도로 본다는 뜻이다 (§4 참고).

### 우리 상황에 직결되는 문장

> "you can **unfollow a few accounts to follow new ones**"

X가 **공식적으로** ratio cap의 해법으로 언팔로우를 제시한다.
지금 계정이 5주째 걸려 있는 cap(§5)에 대해, 정리 작업이 정답 방향이라는 뜻이다.

---

## 3. 서드파티 실측 컨센서스 (비공식, 참고용)

X가 언팔로우 수치를 공개하지 않으므로 운영 도구 업체들의 경험치를 모았다.
**공식이 아니며 서로 상충한다** — 하한선만 참고할 것.

| 항목                | 컨센서스 값                    | 비고                                     |
| ------------------- | ------------------------------ | ---------------------------------------- |
| 언팔로우 일일       | 400 (무료) / 1,000 (Premium)   | "팔로우 한도와 동일"이라는 추정          |
| 언팔로우 시간당     | 30~50                          | 권장 상한이지 확인된 한도 아님           |
| 롤링 윈도우         | 30분당 100 액션                | 여러 업체가 반복 언급                    |
| 실전 안전 일일치    | **50~100** (기존 계정)         | 가장 보수적인 권고                       |
| 액션 간격           | 30~60초                        | 우리 루프가 이미 쓰는 값과 동일          |

> 반복적으로 나오는 경고: **"언팔로우가 팔로우보다 더 빨리 제한에 걸린다."**
> 대량 언팔이 자동화 시그니처로 더 뚜렷해서 안티스팸이 먼저 잡는다는 것.
> 검증된 주장은 아니지만, 언팔 레이트를 팔로우보다 **보수적으로** 잡을 근거는 된다.

---

## 4. ⚠️ 진짜 제약: follow churn (여기가 핵심)

숫자 한도는 "막힘"이지만 churn 위반은 **계정 정지**다. 레이트보다 이쪽이 중요하다.

### X 공식 규정 원문

[About following on X](https://help.x.com/en/using-x/x-follow-limit) — 금지 행위:

> - **"follow churn"** — following and then unfollowing large numbers of accounts in an effort to
>   inflate one's own follower count;
> - **indiscriminate following** — following **and/or unfollowing** a large number of unrelated
>   accounts **in a short time period, particularly by automated means**;

### 개발자 정책 해설 (수치가 나오는 유일한 공식 문서)

[Policy clarification — aggressive following and inorganic following behavior](https://devcommunity.x.com/t/policy-clarification-aggressive-following-and-inorganic-following-behavior/92769)

> These types of aggressive follow actions are an infringement of the Twitter Rules and Automation
> Rules, and **may result in suspension of both an application and associated Twitter accounts**.
>
> Automated follow-back monitoring, and other forms of **follower churning, are not permitted**.
> For example, **following 100 users, waiting 24 hours, then unfollowing the users who haven't
> followed you back** would be considered aggressive following. **Repeatedly following and
> unfollowing a user is a form of spammy behavior, and is never allowed.**

### 우리 계획은 churn인가? — 정직한 평가

| 구분         | X가 금지하는 churn                     | 우리 계획                                    |
| ------------ | -------------------------------------- | -------------------------------------------- |
| 의도         | 팔로워 수 부풀리기                     | 피드 품질 개선 (스캠 제거)                   |
| 재팔로우     | 같은 계정을 반복 팔로우/언팔           | 언팔한 계정은 **영구 제외**                  |
| 판단 기준    | **맞팔 안 해준 사람**                  | 계정 품질 (스캠/봇/홍보)                     |
| 시간 압축    | 24시간 내 대량                         | (설계하기 나름)                              |

**의도는 다르지만 X는 의도를 못 본다. 행동 시그니처만 본다.**
따라서 설계 단계에서 반드시 지켜야 할 것:

1. **언팔한 계정은 절대 재팔로우하지 않는다** — 영구 blocklist 유지.
   "Repeatedly following and unfollowing a user"가 가장 명확한 금지 조항이다.
2. **"맞팔 안 함"을 쓰레기 판정 기준으로 쓰지 않는다.** 이건 인용문에 나온 그 예시 자체다.
   품질 기준(스캠 키워드, 봇 지표, 프로필 특성)만 쓰고, follow-back 여부는 아예 보지 않는다.
3. **언팔 단계와 팔로우 단계를 같은 시간창에서 1:1로 섞지 않는다.** 동시 진행이 churn과 가장
   비슷하게 보인다. 언팔 먼저 → 간격 → 팔로우 순으로 분리한다.
   (마침 cap 때문에 어차피 이 순서일 수밖에 없다 — §5)

---

## 5. 이 계정의 실측 데이터 (가장 신뢰할 만한 근거)

서드파티 추정치보다, **이 계정에서 실제로 무사히 통과한 레이트**가 훨씬 강한 근거다.

### 지난 팔로우 캠페인 (`output/auto-follow-log.jsonl`, 679 사이클)

| 항목                | 값                                         |
| ------------------- | ------------------------------------------ |
| 실제 팔로우 사이클  | 326회 (2026-07-06 ~ 07-29)                 |
| 총 팔로우           | **7,618명**                                |
| 기간                | 555.6시간 (약 23일)                        |
| **실측 레이트**     | **13.7명/시간 · 329명/일**                 |
| 결과                | 스팸 정지 **없음**. ratio cap만 걸림       |

→ **329/일**은 공식 400/일 바로 아래, **13.7/시간**은 서드파티 권고(30~50/h)의 절반 이하.
이 조합이 23일간 안전했다는 게 실증됐다. 언팔 레이트는 여기서 **더 내려서** 시작하면 된다.

### 현재 계정 상태 (2026-09-02, 라이브 조회)

| 항목               | 값                                        |
| ------------------ | ----------------------------------------- |
| 계정               | `@bcd_kyle` (2025-01-16 개설)             |
| 팔로워             | **1,276**                                 |
| 팔로잉             | **7,468**                                 |
| 비율               | **5.85 : 1** (팔로잉 : 팔로워)            |
| Premium(Blue)      | ✅ `isBlueVerified: true`                 |
| cap 상태           | 2026-07-29부터 **5주째 probe 모드**, `capActualCount: 7500` |
| 자연 감소          | 하루 2~3명씩 감소 중 (상대 계정 정지/탈퇴) |

### 여기서 나오는 결론 2가지

**(a) 정리 작업이 cap을 푼다.** cap은 팔로잉 절대수(~7,500)에 걸려 있다. 쓰레기를 N명 언팔하면
팔로잉이 N만큼 내려가고 **그만큼 새로 팔로우할 여유가 1:1로 생긴다.** 5주째 멈춰 있는 루프를
되살리는 유일한 방법이기도 하다.

**(b) 그런데 지난 캠페인의 ROI는 냉정히 봐야 한다.** 7,618명을 팔로우해서 팔로워는 1,276명이다
(그마저도 캠페인 이전분 포함). 비율 5.85:1은 X의 ratio cap이 정확히 측정하는 값이고,
**팔로우 봇의 전형적 프로필**이다. 즉 "쓰레기 언팔 → 좋은 사람 팔로우"로 바꿔도
*팔로우 총량으로 팔로워를 얻는다*는 전제 자체는 이미 한 번 실패했다.
정리 작업의 목표를 "팔로워 증가"가 아니라 **"피드 품질 + cap 해제"**로 잡는 게 정확하다.

---

## 6. 실행 경로 — 우리는 Playwright다 (프록시 아님)

### 지금 쓰는 경로: Playwright 브라우저 — ✅ 동작 중, 단 unfollow 미구현

**지난 7,618건의 팔로우는 전부 Playwright 브라우저로 나갔다. 프록시는 쓰지 않았다.**

- `src/examples/auto-follow.ts:202` → `new BrowserFollowService({ storageStatePath })`
  임포트한 쿠키(`X_AUTH_TOKEN`/`X_CT0` → `.auth/x-session.json`)로 실제 Chromium을 띄워
  프로필 페이지의 Follow 버튼을 누른다. 한국 실 IP 그대로.
- `AutoFollowRunner`는 `IFollower` 인터페이스만 의존하고 (`AutoFollowRunner.ts:139`),
  프록시라는 개념이 코드에 존재하지 않는다.

**막힌 부분은 딱 하나 — 언팔 구현이 없다:**

- `IFollower`는 **`follow(username)` 메서드 하나뿐**. `unfollow`가 없다.
- `BrowserFollowService`에도 언팔 구현이 없다
  (`Unfollow` 문자열은 팔로우 **성공 확인용** 셀렉터로만 등장 — `BrowserFollowService.ts:133`).
- 언팔은 Follow 버튼과 달리 **확인 모달**이 뜬다 → 별도 구현 필요.

### 안 쓰는 경로: twitterapi.io API (`unfollow_user_v2`) — ❌ 애초에 못 씀

`src/services/WriteService.ts:96`에 `unfollowUser()`가 구현돼 있어서 헷갈리기 쉬운데,
**이 경로는 팔로우 캠페인에 한 번도 쓰인 적이 없다.** `WriteService`를 쓰는 곳은
대화형 CLI 메뉴(`src/cli/menu.ts`)와 `src/examples/write-actions.ts` 예제뿐이다.

그리고 지금 호출해도 실패한다:

- 모든 write 호출이 `authBody()` → `login()` → `/twitter/user_login_v2`를 거치는데
  이 로그인은 **`proxy` 파라미터가 필수**다.
- **`.env`의 `X_PROXY`는 비어 있다.** [proxy-services.md](twitterapi-io/proxy-services.md)대로
  Webshare Static Residential 8개 IP가 **전부** `twitter_rate_limit`으로 실패 → 풀 전체가
  X에 flagged로 확정. 재구매 금지 결론이 났고, 그래서 브라우저 경로로 간 것이다.
- 되살리려면 [모바일 프록시 신규 구매](twitterapi-io/proxy-provider-recommendation-2026-07.md)
  (**월 $59~129**)가 선행돼야 한다.

### 판단

**기존 Playwright 경로에 `unfollow()`를 추가하는 게 정답.** 근거:

- 23일간 검증된 세션·리듬·헬스체크 인프라를 그대로 재사용
- 추가 비용 $0 (API 경로는 월 $59~129 프록시 선구매가 전제)
- API 경로는 프록시 문제로 이미 한 번 포기한 경로

⚠️ 단, 브라우저 자동화 자체가 X Automation Rules 위반 소지라는 지적은 서드파티 문서에 반복해서
나온다. 지난 캠페인에서 23일간 문제없었다는 실측이 있지만, **리스크가 0이라는 뜻은 아니다.**
이건 이미 감수하고 진행 중인 기존 리스크와 같은 성격이다.

---

## 7. 권장 레이트 (설계 입력값)

실측(13.7/h 안전) + "언팔이 더 빨리 걸린다"는 컨센서스를 반영해 **보수적으로** 잡은 시작값:

| 단계                 | 권장치                    | 근거                                             |
| -------------------- | ------------------------- | ------------------------------------------------ |
| 언팔로우 시간당      | **8~10명**                | 실측 팔로우 13.7/h보다 낮게. 컨센서스 30~50의 1/4 |
| 언팔로우 일일        | **150~200명**             | 공식 400의 절반 수준, 실측 329보다 낮게          |
| 액션 간격            | **30~90초 랜덤**          | 기존 팔로우 루프와 동일 (검증된 리듬)            |
| 신규 팔로우          | **기존 설정 유지** (25/사이클, ~18/h) | 이미 23일 검증됨                    |
| 언팔↔팔로우 분리     | **최소 수 시간, 이상적으로는 별도 일자** | churn 시그니처 회피 (§4-3)        |
| 전체 정리 기간       | 2,000명 정리 시 **약 10~13일** | 200/일 기준                                 |

> 이 값들은 **시작점**이다. 지난 캠페인처럼 로그를 보면서 조정하는 게 맞다.
> 특히 언팔은 실측 데이터가 없으므로, **처음 며칠은 더 낮게(50~100/일) 잡고
> 계정 반응을 본 뒤 올리는** 게 안전하다.

---

## 8. 열린 질문 (다음 설계 단계에서 결정할 것)

1. **"쓰레기" 판정 기준을 무엇으로 하는가?** — 반드시 품질 지표여야 하고,
   **맞팔 여부는 절대 쓰면 안 된다** (§4-2).
2. **7,468명을 어떻게 스캔하는가?** — 프로필 조회 비용 (~$0.18/1k profiles → 전수 스캔 약 $1.3),
   페이징, 캐싱.
3. **몇 명을 정리 목표로 잡는가?** — cap 해제에 필요한 수 vs 실제 쓰레기 수.
4. **cap 감지 로직과 어떻게 맞물리는가?** — 지금 probe 모드인 루프를 정리 중에 세울지,
   자동 재개에 맡길지.
5. **판정 오류 대응** — 잘못 언팔한 계정은 재팔로우가 §4-1 위반이므로 **되돌릴 수 없다.**
   dry-run 검토 단계가 필수.

---

## 9. 출처

**X 공식**

- [About X limits — X Help](https://help.x.com/en/rules-and-policies/x-limits)
- [About following on X (follow limit & ratio) — X Help](https://help.x.com/en/using-x/x-follow-limit)
- [Policy clarification: aggressive following and inorganic following behavior — X Developers](https://devcommunity.x.com/t/policy-clarification-aggressive-following-and-inorganic-following-behavior/92769)
- [Authenticity (Platform Manipulation and Spam) — X Help](https://help.x.com/en/rules-and-policies/platform-manipulation)
- [The X Rules — X Help](https://help.x.com/en/rules-and-policies/x-rules)

**서드파티 (비공식 경험치)**

- [Twitter/X Follow Limits in 2026: All Caps Explained — Unfollr](https://www.unfollr.com/blog/twitter-follow-limits)
- [Twitter/X Automation Rules in 2026: What's Allowed — Unfollr](https://www.unfollr.com/blog/twitter-automation-rules)
- [Twitter Rate Limit Exceeded: How to Fix It (2026) — Unfollr](https://www.unfollr.com/blog/twitter-rate-limit-exceeded)
- [Twitter Follow Limit 2026: Which Accounts to Unfollow First — Postory](https://postory.io/blog/twitter-follow-limit)
- [How to Mass Unfollow on Twitter/X in 2026 (Safe Methods) — Plugmonkey](https://plugmonkey.xyz/guide/how-to-mass-unfollow-on-twitter/)
- [X (Twitter) Automation Rules and Rate Limits in 2026 — SocialNexis](https://socialnexis.com/guides/twitter-automation-safe-2026)

**리포지토리 내부 근거**

- `output/auto-follow-log.jsonl` — 679 사이클, 실측 레이트 산출 근거
- `.auth/auto-follow-state.json` — cap 상태 (`capDetectedAt`, `capActualCount`)
- [docs/twitterapi-io/proxy-services.md](twitterapi-io/proxy-services.md) — Webshare 실패 실측
- [docs/twitterapi-io/proxy-provider-recommendation-2026-07.md](twitterapi-io/proxy-provider-recommendation-2026-07.md) — 모바일 프록시 대안 및 가격
- [docs/auto-follow-operations.md](auto-follow-operations.md) — 기존 루프 운영 기준
