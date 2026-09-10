# 실행 가능성 판단: Solana DEX ↔ Backpack 토큰화 주식 (2026-09-06 확인)

> 결론: **갭 모니터링과 자산 변환·입출금은 모두 코드로 가능하다.** Backpack 이 직접 발행한 16개 토큰화 주식이 Solana 입금·출금이 모두 열려 있고, 공개 API 로 스팟 호가, 서명 API 로 주문·RFQ·출금·입금주소 조회가 문서화되어 있으며, Jupiter/Raydium 은 키 없이 견적·스왑 트랜잭션을 반환한다. 다만 **현재 관측된 갭은 비용 차감 후 전부 음수**이며, 주중에는 Backpack 쪽이 호가창이 아닌 브로커 RFQ 라서 "공개 가격"이 없다는 점이 가장 큰 구조적 제약이다.

## 1. 대상 자산 (확정)

`GET /api/v1/assets` 에서 `.US` 이면서 Solana 토큰의 `depositEnabled && withdrawEnabled` 인 자산은 16개다.

AMC, BOT, DRAM, GPRO, HOOD, INTC, LLY, MRNA, MRVL, MSTR, MU, NBIS, SKHY, SNDK, SPCX, TTWO (모두 `.US`)

- 발행사: Backpack Securities 본인 (토큰 메타데이터 이름 "SpaceX - Backpack Securities"). Securitize 나 xStocks 가 아니다. 유동성 배포는 Wormhole Labs 의 Sunrise 가 담당.
- 온체인 형태: Token-2022, 소수점 6. 확장: `permanentDelegate`, `pausableConfig`, `defaultAccountState=initialized`, `transferHook(programId=null)`, `scaledUiAmount`(리베이스), freeze authority 보유(`2cVY…`). 즉 **전송에 허용목록은 없고**, 발행사가 동결·회수·일시정지 권한을 갖는다.
- 권리: SPV 에 대한 토큰화 청구권, 1:1 실주식으로 상환 가능. 배당은 토큰 수량으로 재투자(리베이스). 전통 보유분과 다른 법적 형태(UCC 8 vs SPV claim).
- 다른 "같은 이름" 토큰 주의: xStocks 의 SPCXx 등은 별도 민트이며 Backpack 에 입금할 수 없다(Raydium 에 SPCX/SPCXx 풀 존재).

## 2. Backpack 쪽 체결 경로 (세션에 따라 달라짐)

| 세션(ET) | 체결 방식 | 공개 가격 | API |
|---|---|---|---|
| 평일 overnight/pre/regular/post | 브로커 **RFQ** (`<SYM>.US_USDC_RFQ`), deferred settlement, 수락 시 구속력 | 없음. `stockPrice.<TICKER>` WS 스트림(provider bid/ask/mid)만 참고 가능 | `POST /api/v1/rfq` → `GET /api/v1/rfqs` → `POST /api/v1/rfq/accept` |
| 주말·미국 휴장일 | Backpack 자체 **스팟 호가창** (SPCX, MU, SNDK, SKHY 4종만 존재) | 있음. `GET /api/v1/depth`, WS `bookTicker` | `POST /api/v1/order` (Limit/Market, IOC) |

- 정규장 외에는 **정수 주 단위**만 주문 가능(`/api/v1/securities` 의 세션별 minQuantity=1, step=1). 정규장은 0.01주.
- 스팟 주식 거래 수수료 0 (공식). RFQ 도 "견적가가 곧 체결가".
- 타이커 100ms 스피드범프가 스팟 주문에 적용.
- 이용 제한: 미국·영국·UAE·일본, Backpack EU 불가. 그 외 KYC 완료 계정.

## 3. 자산 변환·입출금

| 방향 | 방법 | 비용 | 소요 |
|---|---|---|---|
| Backpack → Solana (토큰화) | `POST /wapi/v1/capital/withdrawals` `{symbol:"SPCX.US", blockchain:"Solana", address, quantity, twoFactorToken?}` | 약 $0.5 를 주식 수량으로 차감(SPCX 0.004주, MU 0.0005주 …) | 일반 Solana 출금과 동일, "수분~1시간" |
| Solana → Backpack (상환) | 사용자 전용 입금주소(`GET /wapi/v1/capital/deposit/address?blockchain=Solana`)로 Token-2022 전송 | 무료 + 네트워크 수수료 | 문서상 미명시. 코드에서는 잔고/입금내역 폴링 |

- 출금은 **주소록에 2FA 면제로 등록한 주소가 아니면 `twoFactorToken` 필수**. 무인 실행하려면 지갑 주소를 주소록에 미리 등록해야 한다(API 로 확인 불가).
- 입출금이 미국 장중에만 되는지 문서에 제한 문구 없음(GitBook Q&A 확인). 실측 필요.
- 입금 후 매도까지: 주말이면 스팟북, 평일이면 RFQ. 즉 **DEX→Backpack 방향은 평일에 브로커 견적을 받아야 매도 가능**.

## 4. DEX 견적 API (실측)

| API | 키 | 실측 결과 |
|---|---|---|
| Jupiter `lite-api.jup.ag/swap/v1/quote` + `/swap/v1/swap` | 불필요 | 견적·트랜잭션 빌드 정상. 라우트: GoonFi V2, TesseraV, Byreal, Raydium CLMM |
| Jupiter `lite-api.jup.ag/ultra/v1/order` (+`/execute`) | 불필요 | 정상, `feeBps=10` (Ultra 수수료) |
| Jupiter `api.jup.ag/swap/v2/order` | 키 권장 | 이 세션에서는 키 없이도 200 |
| Jupiter `price/v3` | 불필요 | 16종 전부 가격·유동성 반환 |
| Raydium `transaction-v1.raydium.io/compute/swap-base-in` | 불필요 | 정상. SPCX/USDC CLMM TVL ≈ $354k |
| Orca `api.orca.so/v2/solana/pools?token=` | 불필요 | SPCX/USDC whirlpool 존재 |
| Meteora DLMM/DAMM API | 불필요 | SPCX 풀 검색 결과 없음 |

권장: **Jupiter(집계) 로 감지 + Raydium(개별) 로 교차 검증**. Orca 는 SDK 필요, Meteora 는 대상 풀 없음.

## 5. 현재 갭 스냅샷 (2026-09-06 주말 세션, 1주 기준, 비용 반영)

| 종목 | BP bid/ask | DEX sell/buy | DEX→BP | BP→DEX |
|---|---|---|---|---|
| SPCX | 150.19 / 150.24 | 150.18 / 150.23 | −9.5 bps | −47.5 bps |
| MU | 1014.40 / 1016.57 | 1015.64 / 1019.07 | −46.8 bps | −14.6 bps |
| SNDK | 1763.91 / 1770.16 | 1766.08 / 1768.47 | −26.3 bps | −26.4 bps |
| SKHY | 175.47 / 176.13 | 175.60 / 175.69 | −18.2 bps | −62.6 bps |

양쪽 스프레드가 겹쳐 있어 즉시 실행 가능한 기회는 없었다. BP→DEX 방향은 출금 수수료($0.5 상당)가 1주 기준 30~40bps 를 잠식한다. 수량을 키우면 수수료 비중은 줄지만 호가 깊이 소진이 커진다(스냅샷에 `bpPartial`, `dexBuyImpact` 로 기록).

## 6. 구조적 제약 (아티클 3~6장 근거)

1. **평일 가격 비대칭**: Solana 는 24/7 AMM 가격, Backpack 은 브로커 RFQ. 공개 호가가 없어 "관측된 갭" 자체를 RFQ 없이 정의할 수 없다. 모니터는 provider 스트림(`stockPrice`)을 참고값으로 쓰며, 실제 체결가는 RFQ 로만 확인된다.
2. **지연**: 출금 수분~1시간 동안 DEX 가격이 움직인다. 양 시장에 재고를 미리 두는 방식이 아니면 지연 위험이 남는다.
3. **정수 주 제약**: 정규장 외 RFQ 는 1주 단위. 고가 종목(SNDK ≈ $1,770)은 최소 티켓이 크다.
4. **발행사 권한**: permanentDelegate·pause·freeze 로 발행사가 토큰을 회수·정지할 수 있다. DEX 유동성 공급자에게 신용 위험.
5. **지역·계정 제한**: 미국 등 불가. 한국은 명시적 제외 대상 아님(Backpack 지원 국가 확인 필요).
6. **미확인**: 입금이 계정에 반영되는 실제 시간, 주말 출금 처리 여부, RFQ 브로커 스프레드 크기, 대량 출금 한도(`maximumWithdrawal=null`).

## 7. 코드 상태

- 모니터: 키 없이 동작. `node src/cli.js monitor` → `data/gaps.jsonl`.
- 실행: `exec --live` 로 두 방향 모두 구현. dry-run 검증 완료, 실계좌 라이브 실행은 미수행.
- 서명 형식: 임시 키로 `GET /api/v1/capital` 200 응답 확인(서명 검증 통과, 미등록 키라 잔고 빈 객체).

## 출처 (확인일 2026-09-06)

- Backpack API 문서 https://docs.backpack.exchange/ (Stock Trading, RFQ Lifecycle, Request withdrawal, Get deposit address, Changelog 2026-07-11/08-03)
- 공개 엔드포인트 실측: `/api/v1/markets`, `/api/v1/assets`, `/api/v1/securities`, `/api/v1/market-sessions`, `/api/v1/market-holidays`, `/api/v1/depth`
- Backpack Support: Tokenized Securities, Conversion Flow, Stock Trading Hours & Fees, Weekend Stock Trading, Eligibility & Access, FAQs (support.backpack.exchange/backpack-securities/…)
- Backpack Learn: access-us-securities-onchain, tokenized-stocks-on-chain-equities-ipo-access, what-is-sunrise
- Solana: how-external-assets-start-trading-on-solana-from-day-one (Sunrise/Wormhole NTT, SPCX)
- Solana Compass: Backpack Securities MSTR/MRNA/SPCX/GPRO 기사
- 온체인: SPCX 민트 `SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb` getAccountInfo(jsonParsed)
- Jupiter lite-api, Raydium transaction-v1 / api-v3, Orca api.orca.so 실측
