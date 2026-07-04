# 프록시 업체 추천 (2026-07-04 기준)

> **배경:** Webshare Static Residential IP 8개(+High IP Reputation, +TOTP, 5개국)가 twitterapi.io login v2에서 전부 `twitter_rate_limit`으로 실패. 브라우저(한국 실IP)만 성공. → Webshare 풀 전체가 X의 Castle 안티봇에 flagged. 상세: [proxy-services.md](proxy-services.md) 하단 실측 결과.
>
> **이 문서 목적:** Webshare를 대체할, X 로그인/write에 실제로 통하는 프록시 업체를 오늘 기준으로 조사·추천.

## 핵심 원칙 (2026 기준 업계 컨센서스)

- **datacenter 프록시는 이제 X에서 안 됨** (우리 실측과 일치)
- **static residential**: 기존 계정 관리(트윗/팔로우)엔 좋지만 — **재판매 대역이면 통째로 flagged될 수 있음** (← Webshare가 이 케이스)
- **mobile(4G/5G)**: 통신사 CGNAT IP라 **신뢰도(trust score) 최고, ban율 최저**. 새 계정 생성·strict 안티봇 통과에 최선. twitterapi.io 에러도 계속 "dedicated residential **or mobile**"을 권함
- **sticky session 필수**: twitterapi.io는 로그인~포스팅 **같은 IP 유지** 요구 → rotating이라도 sticky/session 고정 옵션이 있어야 함

## 성공률 데이터 (Coronium 벤치마크, 참고용)

| 프록시 종류        | X(Twitter) 로그인 성공률 |
| ------------------ | :----------------------: |
| Datacenter         |          30~60%          |
| Residential        |          70~85%          |
| **Mobile (4G/5G)** |        **95~99%**        |

→ 우리처럼 residential이 막힌 상황에선 **mobile로 올라가는 게 정답.**

---

## 추천 업체 (용도별)

### 🥇 1순위 (확실성 최우선) — Coronium ⭐ "X 전용 dedicated 모바일"

- **X/Twitter 전용 상품** 페이지를 따로 운영, _"99.4% success rate on X"_ 표방
- **dedicated 4G 모바일** — 물리 기기 1개를 나만 독점 (공유 아님) → trust score 최상
- 가격(월, 국가별): 🇯🇵 일본 **$129** / 🇫🇷 프랑스 $79 / 🇩🇪 독일 $89 / 🇬🇧 영국 $97 / 🇺🇸 미국 $129 / 🇹🇭 태국 $59
- 한국은 없음 → **일본($129)** 이 우리 계정(한국)에 지리적으로 가장 가까운 선택
- on-demand/scheduled/API 로테이션 제어 → sticky 유지 가능
- **장점:** X에 특화, 성공률 압도적. **단점:** 비쌈(월 $129), 한국 없음
- 👉 "돈 좀 들어도 확실하게 한 번에 되게" 하고 싶으면 이거

### 🥈 2순위 (가성비 모바일) — IPRoyal Mobile

- **rotating 모바일 $5.20/GB~** (100GB 기준, 소량은 $6.80/GB) — **트래픽 과금**이라 테스트처럼 데이터 적게 쓰면 **월 몇 달러**로 끝남
- dedicated 모바일도 있음($130/월~) — Coronium과 비슷한 급
- IP 세션 커스텀 지원(sticky 설정 가능)
- ⚠️ **아시아 로케이션 약함** — 말레이시아/인도/중국은 있으나 **일본·한국 없음** (page 기준). 아시아 IP가 중요하면 확인 필요
- 👉 "싸게 mobile을 찔러보고 싶다" → rotating $/GB로 소액 테스트 최적

### 🥉 3순위 (대규모·최고 안정성) — Bright Data / Oxylabs / Decodo

- **Bright Data**: 세계 최대 모바일망(700+ 통신사). 성공률·안정성 최고, 단 비싸고($5~8/GB) 설정 복잡
- **Oxylabs**: 대규모 residential+mobile, 엔터프라이즈급
- **Decodo(구 Smartproxy)**: 모바일 10M+ IP, PAYG $8/GB(프로모 $4/GB), 상위 티어 $2.25/GB. 700+ 통신사·160+ 지역
- 👉 스케일업하거나 멀티계정 운영으로 갈 때. 지금 단발 테스트엔 오버스펙

### 참고 — Astro / ProxyWing (중소 모바일, 저가 진입)

- **ProxyWing**: $4/day, $15/week, $55/month — rotation+sticky 포함. 단기 테스트에 저렴
- **Astro**: sticky session(타이머/연결별) 세밀 제어

---

## 우리 상황 최종 추천

**계정: 한국 계정 `bcd_kyle`, 목적: 트윗 포스팅 테스트(데이터 소량), 예산: 최소 지향**

|       순위        | 선택                                | 이유                                                                  | 예상 비용 |
| :---------------: | ----------------------------------- | --------------------------------------------------------------------- | :-------: |
|   **A (권장)**    | **IPRoyal Mobile (rotating, $/GB)** | 트래픽 소량이라 **월 몇 달러**로 mobile 검증 가능. 실패해도 손실 적음 |   ~$5~7   |
|  **B (확실성)**   | **Coronium 일본 dedicated**         | X 전용·성공률 99%+·일본(한국 최근접). 한 번에 되게 하려면             |  $129/월  |
| **C (저가 단기)** | **ProxyWing 주간/월간 mobile**      | $15/week 등 짧게 끊어 테스트                                          |   ~$15    |

### 제안 경로

1. 먼저 **A(IPRoyal mobile rotating)** 로 소액($5~7) 테스트 — mobile이 실제로 뚫는지 저비용 검증
   - ⚠️ IPRoyal에 일본/한국 IP가 있는지 가입 전 확인. 없고 아시아가 중요하면 → B로
2. A가 되면 끝. 안 되거나 아시아 IP 문제면 → **B(Coronium 일본 dedicated)** 로 확실하게
3. 스케일 필요해지면 → Bright Data/Oxylabs

### ⚠️ 공통 체크리스트 (어느 업체든)

- [ ] **mobile(4G/5G)** 상품일 것 (datacenter/static-res 아님)
- [ ] **sticky session / IP 고정** 지원 (twitterapi.io 필수 요건)
- [ ] 프록시 형식이 `http://user:pass@ip:port` 로 뽑히는지 (그대로 `X_PROXY`에)
- [ ] 가능하면 **일본** 등 아시아 로케이션 (한국 계정 위치 일치)
- [ ] TOTP는 이미 `.env`에 설정됨 → 그대로 유지

### Webshare 처리

- Static Residential은 이 용도에 **불가 확정** → 결제 후 며칠 이내면 **환불 문의** 고려
- (스크래핑용 read API엔 쓸 수 있으니 유지할 이유가 있으면 남겨도 됨)

## 출처

- [8 Best Mobile Proxies in 2026 — DataImpulse](https://dataimpulse.com/blog/best-mobile-proxies/)
- [8 Best Mobile Proxies 2026 — AIMultiple](https://aimultiple.com/mobile-proxy)
- [X (Twitter) Mobile Proxies — Coronium](https://www.coronium.io/mobile-proxies/x)
- [IPRoyal Mobile Proxies](https://iproyal.com/mobile-proxies/)
- [Twitter (X) Proxies Setup Guide 2026 — ProxyWing](https://proxywing.com/blog/how-to-use-twitter-with-a-proxy-safe-setup-best-proxy-types)
- [Best Twitter Proxies 2026 — AIMultiple](https://aimultiple.com/twitter-proxies)
- [twitterapi.io login guide](https://twitterapi.io/blog/twitter-login-and-post-api-guide)
