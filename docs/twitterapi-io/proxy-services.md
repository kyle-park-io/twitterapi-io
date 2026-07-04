# X_PROXY 프록시 서비스 조사

twitterapi.io의 **write 작업(로그인 → 트윗/좋아요/팔로우 등)**에는 `X_PROXY`가 **필수**입니다.
`../../src/services/WriteService.ts`가 login/create 요청 body에 `proxy: this.config.xProxy`로 전달하며,
twitterapi.io 서버가 이 프록시를 통해 실제 X 계정에 로그인합니다. 그래서 계정 정지를 피하려면
**주거용(residential) 프록시**가 사실상 필수입니다.

## twitterapi.io의 프록시 요구사항 (공식 문서 기준)

| 항목           | 요구사항                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| 프록시 형식    | `http://username:password@ip:port`                                                         |
| 프로토콜       | **HTTP만** 예시로 제공됨 (SOCKS 언급 없음)                                                 |
| 타입           | **고품질 residential** 필수 — 무료/데이터센터 프록시 금지                                  |
| 권장           | **Static Residential** (고정 IP)                                                           |
| 일관성 규칙    | 로그인부터 트윗까지 **전 과정에서 동일한 프록시** 사용 필수. 2FA 로그인도 같은 프록시 사용 |
| 공식 추천 업체 | **Webshare.io** (Static Residential)                                                       |

> 즉 rotating(요청마다 IP 변경) 프록시가 아니라, **한 세션 동안 고정된 IP**를 쓰는 static residential이 이 유즈케이스에 맞습니다.

## 추천 순위

### 1위 — Webshare.io ⭐ (공식 추천, 이걸로 시작하는 걸 권장)

- twitterapi.io **공식 문서가 직접 추천**하는 유일한 업체
- **Static Residential** 상품이 이 유즈케이스(고정 IP 유지)에 정확히 부합
- 무료 티어 있음(10 datacenter 프록시) → 단, write용으론 반드시 **Static Residential** 유료 상품을 써야 함
- 가격이 저렴하고 셀프서비스로 바로 시작 가능
- 대시보드에서 `user:pass@ip:port` 형태를 바로 복사 → `X_PROXY`에 붙여넣기만 하면 됨
- **결론: 검증·호환성이 확실하므로 여기서 시작하는 게 가장 안전**

### 2위 — IPRoyal (가성비 대안)

- Residential + **ISP 프록시**(=static residential과 유사한 고정 IP) 제공
- ISP 프록시가 시간당 과금($1.80/proxy/24h 수준)이라 소규모 자동화에 부담 적음
- Pay-as-you-go, 대역폭 무제한 옵션 → 예산 민감한 경우 적합
- city/state 타게팅 지원

### 3위 — SOAX / Bright Data / Oxylabs (대규모·엔터프라이즈)

- **Bright Data**: 최대 규모 residential 네트워크, 성공률·안정성 최고 → 대량 추출/멀티계정 스케일에 강함. 다만 비싸고 설정 복잡
- **Oxylabs**: 1억 7500만+ residential IP, 대규모 운영용
- **SOAX**: residential+mobile, 세션 최대 60분 유지 가능
- 단일 계정 몇 개 자동화 수준이면 오버스펙 → 규모가 커질 때 고려

### 참고 — 신규 계정 워밍업이면 Mobile 프록시

- **새 계정 생성/워밍업**에는 mobile 프록시가 신뢰도(trust score) 가장 높고 ban rate 최저
- 기존 계정 자동화에는 static residential로 충분

## MCP / Skill 관점

- 조사 결과, 위 프록시 업체들은 **자동화용 skill/MCP를 직접 제공하지 않습니다** (프록시는 단순 IP 자원 판매 형태).
- 이미 `twitterapi-io` **skill**을 쓰고 있으므로, 프록시는 그 skill의 write 경로에 `X_PROXY` 값으로만 꽂으면 됩니다. 별도 MCP/skill 통합은 불필요.
- twitterapi.io 자체는 skill(Claude/LobeHub 마켓플레이스에 커뮤니티 skill 존재) 형태로 이미 생태계가 있음.

## 실제 설정 방법

`.env`의 write 관련 변수 채우기:

```bash
# Webshare Static Residential 대시보드에서 복사한 값
X_PROXY=http://<user>:<pass>@<ip>:<port>
X_TOTP=            # 계정에 2FA(TOTP) 켜져 있을 때만. base32 시크릿
```

- `X_PROXY`는 반드시 `http://` 스킴 포함
- 로그인·포스팅 전 과정에서 **같은 프록시 유지** (twitterapi.io가 세션 일관성을 요구)
- `X_TOTP`는 선택 — 계정에 2FA가 켜져 있을 때만 필요

---

# Webshare 실전 구매 가이드 (트윗 포스팅 테스트용)

한 달 정도 트윗 포스팅 테스트를 돌리기 위한 Webshare Static Residential 구매 결정 정리.

## 1. 상품(플랜) 선택 — **Static Residential**

| 옵션                            | 선택 | 이유                                                                     |
| ------------------------------- | :--: | ------------------------------------------------------------------------ |
| Datacenter ($2.99)              |  ❌  | 데이터센터 IP → X 로그인 봇 탐지로 막힘. twitterapi.io가 명시적으로 금지 |
| **Static Residential ($6.00~)** |  ✅  | twitterapi.io **공식 추천**. residential + 고정 IP 둘 다 만족            |
| Rotating Residential ($3.50)    |  ❌  | 요청마다 IP 변경 → "전 과정 같은 프록시" 규칙 위반                       |

> 조건 2개를 **동시에** 만족해야 함: (1) residential (2) static(고정 IP). 둘 다 되는 건 Static Residential뿐.

## 2. Exclusivity(독점성) — **Private**

같은 IP(서브넷)를 **몇 명이 공유하느냐** 차이. 속도가 아니라 IP 평판 리스크 차이.

| 등급        | 공유 인원 |                 IP 평판 위험                 |   가격    |
| ----------- | --------- | :------------------------------------------: | :-------: |
| Shared      | 3명 이상  | 🔴 높음 (다른 유저가 flag한 IP 만날 수 있음) |  가장 쌈  |
| **Private** | 1~2명     |                   🟡 중간                    |  중간 ✅  |
| Dedicated   | 나 혼자   |                   🟢 낮음                    | 가장 비쌈 |

> 화면의 `249/182/350 SUBNETS`는 **가격이 아니라 고를 수 있는 서브넷 재고 수**. 가격은 각 등급 클릭 후 `$/IP` 총액으로 확인.
>
> X 로그인은 IP 평판에 민감 → Shared는 flagged IP 위험. 테스트엔 **Private**이 가성비·안전 균형.

## 3. Proxy Number — **20 IPs (최소)**

- Static Residential 최소 구매 단위가 20개. IP 1개만 살 수는 없음.
- 20 × $0.60 = **약 $12/월**. 그중 실제로 `X_PROXY`엔 IP 1개만 골라 사용.

## 4. Bandwidth — **250 GB (최소)**

- Bandwidth = 프록시로 오가는 데이터 총량(HTML/이미지/API 요청·응답 등).
- 트윗 포스팅 테스트는 로그인+트윗+삭제 한 세션에 **1 MB 미만**. 하루 수십 번 돌려도 몇십 MB.
- 250 GB는 이 용도엔 **사실상 무제한**. 최소로 충분.

## 5. Location — **계정의 평소 로그인 국가와 일치**

- 프록시 Location = **프록시 IP가 위치한 나라** (내 물리적 현재 위치 아님).
- X는 로그인 시 "평소 로그인 위치와 달라지는지"를 봄 → 다르면 보안 챌린지(이메일/문자 인증) 발생 → twitterapi.io 로그인 단계에서 테스트 실패.
- **이 계정은 한국에서 쭉 쓰던 계정** → 프록시도 **한국(🇰🇷)** 으로 맞춰야 함. **US 선택 시 막힐 위험 있음.**
- ⚠️ 미해결: Webshare 목록에 한국이 보이는지 확인 필요. 없으면 차선 **일본(🇯🇵)**, 그것도 없으면 재상의.
- (참고: 새 계정/로그인 이력 거의 없는 계정이면 US여도 무방)

## 6. Replacements(IP 교체) 옵션

| 항목                   | 선택               | 이유                                           |
| ---------------------- | ------------------ | ---------------------------------------------- |
| Recurring Replacements | **No Refreshes**   | IP 자동 교체 끔. 세션 내내 같은 IP 유지해야 함 |
| Manual Replacements    | 10 IPs (최소/기본) | 테스트엔 거의 안 씀                            |

## 7. Add-on 옵션 — 대부분 끄기

| 옵션                                                  |      선택      | 이유                                                                       |
| ----------------------------------------------------- | :------------: | -------------------------------------------------------------------------- |
| Rotating Residential 끼워팔기 (Often Bought Together) |    ❌ 해제     | Static만 필요. 불필요한 추가 비용                                          |
| High Concurrency ($8.68)                              |       ❌       | 동시 요청 수 증가 — 테스트 불필요                                          |
| High Priority Network ($5.79)                         |       ❌       | 지연시간 최적화 — 테스트 불필요                                            |
| High IP Reputation ($7.31)                            | 🤔 처음엔 끄기 | Fraud 0% IP로 CAPTCHA 확률↓. Private이면 대개 불필요. **막히면 그때 켜기** |
| Unlimited IP Authorizations ($5.00)                   |       ❌       | 1개 무료로 충분                                                            |

## 최종 요약

> **Static Residential / Private / 20 IPs / 250 GB / 한국(없으면 일본) / No Refreshes / add-on 전부 해제**
> → 약 **$12/월**, **auto-renew(자동갱신) 끄기** (한 달만 쓸 거면)
> → CAPTCHA·로그인 차단 발생 시에만 High IP Reputation 켜서 재시도

구매 후: 대시보드 **Proxy → List**에서 IP 하나의 `IP:PORT:USER:PASS` 확인 →
`X_PROXY=http://<USER>:<PASS>@<IP>:<PORT>` 형식으로 `.env`에 입력.

---

# ⚠️ 실측 결과 (2026-07-04): Webshare Static Residential = X 로그인 **불가**

> **위 "Webshare로 시작하라"는 권장은 실제 테스트에서 실패했습니다.** 아래가 실측 결론.

`bcd_kyle` 계정으로 twitterapi.io login v2를 **10회** 시도, 전부 `error_kind: twitter_rate_limit` 실패.
브라우저(한국 실제 IP) 직접 로그인은 **성공** → 계정·자격증명은 정상. 문제는 **Webshare IP 풀**.

| #   | IP 지역                 | 등급                                   | 결과          |
| --- | ----------------------- | -------------------------------------- | ------------- |
| 1~6 | 일본 ×여러개            | Private / Dedicated (1.5h 쿨다운 포함) | ❌ rate_limit |
| 7   | 홍콩                    | Dedicated                              | ❌ rate_limit |
| 8   | 미국                    | Dedicated                              | ❌ rate_limit |
| 9   | 일본(기존 IP)           | + **High IP Reputation** add-on        | ❌ rate_limit |
| 10  | 프랑스(신규 IP)         | + **High IP Reputation** add-on        | ❌ rate_limit |
| —   | **브라우저(한국 실IP)** | —                                      | ✅ **성공**   |

## 확정된 사실

- ❌ **계정 문제 아님** (브라우저 로그인 성공)
- ❌ **지역 문제 아님** (JP·HK·US·FR 전부 동일 실패)
- ❌ **등급 문제 아님** (Dedicated도 실패)
- ❌ **쿨다운으로 해결 안 됨** (1.5h 쉬어도 실패)
- ❌ **High IP Reputation add-on($7.31)도 소용없음** — 신규 0% fraud IP도 실패
- ✅ **결론: Webshare "Static Residential" IP 풀 전체가 X(트위터)에 통째로 flagged.**
  (Webshare Static Residential은 실제로 Comcast/AT&T 등 **ISP 재판매 대역**이라 X가 datacenter처럼 광범위 차단)

## Webshare에서 시도할 수 있는 게 더 없는 이유

- Datacenter → 더 나쁨
- Rotating Residential → IP 유지 안 돼서 twitterapi.io "같은 프록시" 규칙 위반
- **Mobile → Webshare는 상품 자체가 없음** (datacenter/static-res/rotating-res 3종뿐)
- High IP Reputation → 위에서 실패 확인

## 다음 방향: **모바일 프록시** 또는 **진짜 rotating residential(sticky)** 업체로 전환

twitterapi.io 에러 메시지가 10회 내내 _"dedicated residential **or mobile** proxy"_ 를 권함.
Webshare로는 불가 확정 → 다른 업체 필요:

- **모바일(4G/5G/LTE)**: 통신사 IP라 X가 거의 차단 못 함. 가장 확실. 업체: Oxylabs, Bright Data, IPRoyal, Proxy-Seller, SOAX
- **진짜 residential**: Bright Data / Oxylabs / SOAX의 rotating residential + **sticky session**(IP 고정) 필수
- ⚠️ twitterapi.io는 로그인~포스팅 **같은 IP 유지** 요구 → mobile이든 residential이든 **sticky/session 지원 상품**을 골라야 함

## 교훈

- **Webshare Static Residential은 X 계정 로그인/자동화에 부적합.** (스크래핑용 read API엔 문제없을 수 있으나, login v2 write 경로는 막힘)
- twitterapi.io 문서가 Webshare를 추천하지만, **실측상 X login에는 통하지 않음.** 재구매 금지.

---

## 출처

- [Complete Guide: Login to Twitter and Post Tweets Using API — twitterapi.io](https://twitterapi.io/blog/twitter-login-and-post-api-guide)
- [User Login v2 API Reference — docs.twitterapi.io](https://docs.twitterapi.io/api-reference/endpoint/user_login_v2)
- [Best Twitter (X) Proxies in 2026 — IPRoyal](https://iproyal.com/blog/best-twitter-proxies/)
- [Best Twitter Proxies in 2026 — AIMultiple](https://aimultiple.com/twitter-proxies)
- [The 7 Best Twitter Proxies — Proxyway](https://proxyway.com/best/twitter-proxy)
