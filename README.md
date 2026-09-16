# backpack-rwa-arb

Solana DEX ↔ Backpack 토큰화 주식(Backpack Securities 발행, Solana Token-2022) 간의
가격 갭 모니터와, 실제 자산 변환(매수 → 전송/입금 → 매도)까지 이어지는 실행 파이프라인.
기획안은 [landing.md](landing.md), 실행 가능성 판단은 [docs/feasibility.md](docs/feasibility.md) 참고.

## 설치

```bash
npm install
cp .env.example .env   # 모니터만 쓸 때는 키 없이도 동작
```

## 명령

```bash
node src/cli.js universe            # Solana 입출금이 켜진 Backpack 토큰화 주식 × 스팟/RFQ 시장
node src/cli.js session             # 현재 미국 주식 세션(ET) → Backpack 체결 경로(스팟북 / RFQ)
node src/cli.js snapshot --qty=1    # 1회 갭 스냅샷 (Jupiter)  --provider=raydium 로 개별 DEX 비교
node src/cli.js monitor [--qtys=1,10]   # 반복 수집, data/gaps.jsonl 에 기록
node src/cli.js rt pairs SPCX.US --shares=0.01 --n=4   # RFQ 매수→매도 쌍거래(실체결), data/rfq.fills.jsonl
node src/cli.js backtest --sensitivity SPCX.US MU.US --spreads=10,20,30
node src/cli.js pools SPCX.US       # Raydium 풀 목록(TVL 순)
node src/cli.js plan SPCX.US        # 양방향 단계 계획 + 비용 반영 순수익 (dry)
node src/cli.js preflight SPCX.US   # 키·잔고·입금주소·세션·입출금 플래그 점검
node src/cli.js rfq SPCX.US --qty=1 --side=Bid   # 브로커 RFQ 견적 받고 취소 (Backpack USDC 잔고 필요) → data/rfq.jsonl
node src/cli.js report              # data/gaps.jsonl 종목×세션 요약
node src/cli.js exec SPCX.US --dir=dexToBp            # dry-run (기본)
node src/cli.js exec SPCX.US --dir=bpToDex --live --2fa=123456   # 실제 실행
```

## 수익 계산 (landing.md 수식 그대로)

```
순수익 = 전송 후 매도 가능한 수량의 예상 매도 대금
       − 최초 수량 q 의 예상 매수 대금
       − 위 대금에 포함되지 않은 비용 (Solana tx, 출금 수수료[주식 수량으로 차감])
```

- DEX 견적(outAmount)과 Backpack 호가 VWAP 에는 이미 가격 영향이 포함되어 있으므로 슬리피지를 중복 차감하지 않는다.
- Backpack 출금 수수료는 토큰(주식) 수량에서 차감되므로 매도 수량에서만 뺀다(`/api/v1/assets` 의 `withdrawalFee`).
- Backpack 주식 스팟은 수수료 0(공식 문서). `BP_SPOT_FEE_BPS` 로 조정 가능.
- 평일 RFQ 참고 모델은 두 기준을 같이 기록한다. **기대(exp)**: 미국 시장 최근가를 정산가의 대용값으로 사용하는 가정. **보수(cons)**: 최근가에 ±15 bps를 적용한 가정 가격. 둘 다 해당 수량으로 실제 받은 RFQ가 아니며, 보수 기준도 손실 상한이나 실행 보장이 아니다. 실제 매도 RFQ는 별도 `compare --bp-rfq`로 구분한다. 기회 플래그는 기대 기준 순수익이 `EDGE_BPS + RFQ_SETTLE_VAR_BPS` 이상일 때, 호가창 경로는 `EDGE_BPS` 이상일 때.
- 수량은 `QTYS`(기본 1,10주)마다 따로 기록한다. 출금 수수료는 주식 수량 고정이라 수량이 클수록 희석되고, 대신 호가 깊이·가격 영향이 커진다.

## 백그라운드 수집

```bash
POLL_MS=30000 nohup node src/cli.js monitor > data/monitor.log 2>&1 &
tail -f data/monitor.log
```

Jupiter lite-api 무료 한도를 고려해 30초 주기를 권장한다. `data/ticks.jsonl`에는 WS 원시 값(`stockPrice` 평일 브로커 참고 bid/ask, `bookTicker` 주말 호가)이 스트림당 5초 간격으로 남는다.

## 데이터 형식 (`data/gaps.jsonl`, 1행 = 1토큰 1관측)

`ts, session, symbol, qty, bpVenue, bpBasis(book|rfq-expected), bpBid, bpAsk, bpBuyPx, bpSellPx, bpPartial,
dexProvider, dexSellPx, dexBuyPx, dexSellImpact, dexBuyImpact, dexSellRoutes, dexBuyRoutes,
dexToBpNet, dexToBpBps(기대), dexToBpConsBps(보수), bpToDexNet, bpToDexBps, bpToDexConsBps, withdrawalFeeShares, latencyMs`

## 구조

```
src/backpack/public.js   markets/assets/securities/depth/sessions (무인증)
src/backpack/auth.js     ED25519 서명 (instruction=…&k=v…&timestamp&window)
src/backpack/private.js  잔고, 입금주소, 출금, 스팟 주문, RFQ 제출/조회/수락
src/backpack/ws.js       stockPrice.<TICKER>, bookTicker.<SYMBOL> 캐시
src/dex/jupiter.js       V1/Ultra, V2 order+execute, DEX-restricted V2 build quotes
src/compare.js           V1/V2/DEX별 병렬 견적 비교 (읽기 전용)
src/dex/raydium.js       compute/swap-base-in, 풀 목록
src/session.js           ET 세션 판정 + market-holidays
src/pricing.js           VWAP·견적 → 양방향 순수익
src/monitor.js           수집 루프/JSONL 기록
src/executor.js          preflight / plan / 실행(dry 기본, --live 게이트)
src/solana/wallet.js     키 로드, Token-2022 전송(ATA idempotent), 서명·전송
```

## V1·V2·개별 DEX 견적 비교

`.env`의 `JUPITER_API_KEY`를 설정한 뒤 실행합니다. 기존 `JUPITER_MODE=lite` 설정을 바꾸지 않고 세 종류의 견적을 비교할 수 있습니다. 키가 없으면 V1으로 몰래 대체하지 않고 오류를 표시합니다.

```bash
# 현재 지원하는 DEX 이름 확인 (대소문자와 공백까지 일치해야 함)
node src/cli.js dex-labels

# V1 전체 경로와 V2 통합 견적만 비교. 개인키 불필요.
node src/cli.js compare SPCX.US --qty=1

# 두 DEX의 제한 견적도 함께 조회. YOUR_PUBLIC_ADDRESS는 지갑 공개주소로 교체.
node src/cli.js compare SPCX.US --qty=1 --dexes="Raydium CLMM,Meteora DLMM" --taker=YOUR_PUBLIC_ADDRESS

# 30초 대기 후 다음 회차 반복. 한 회차는 네트워크 요청 시간만큼 추가로 걸림.
node src/cli.js compare SPCX.US --qty=10 --dexes="Raydium CLMM,Meteora DLMM" --taker=YOUR_PUBLIC_ADDRESS --poll=30000
```

`compare`는 서명·매매·출금을 하지 않으며 개인키를 읽지 않습니다. `--live`는 거부합니다. DEX별 조회는 V2 `/build`의 `dexes` 제한을 사용하며, 반환된 경로도 지정한 DEX에 속하는지 검사합니다. DEX 하나를 지정해도 그 DEX의 여러 풀을 거칠 수 있습니다. 풀별 주소는 `quotes[].routePlan`에 남습니다. 유효한 DEX 이름이라도 해당 토큰의 거래 경로가 없을 수 있습니다.

결과는 기존 `gaps.jsonl`과 분리된 `data/quotes.compare.jsonl`에 기록합니다. 한 종목·수량·회차당 `v1-all`, `v2-all`, 지정한 DEX별 행을 저장합니다. 요청 시작·종료 시각, 반환된 경로, 라우터, 예상 수령량, 최소 수령량, API가 반환한 수수료 정보, 실패 원인을 기록합니다. 서명할 트랜잭션 본문은 저장하지 않습니다.

- 모든 출처는 같은 회차의 참고 가격으로 같은 USDC 매수 금액을 조회합니다. 매수 수령량은 정확히 1주로 고정되지 않습니다. 참고 가격을 얻지 못하면 중단하며, 필요하면 `--ref-price=150`처럼 **매수 수량 산정용** 가격만 지정할 수 있습니다. 이 값으로 Backpack 거래 가격을 만들어내지는 않습니다.
- 매도 견적은 `신청 수량 − 출금 수수료`를 토큰 최소 단위로 계산해 조회합니다. 수수료·최소 출금량 때문에 출금이 불가능하면 그 방향을 실패로 기록합니다.
- `--max-age=5000`은 기본 5초입니다. 회차 종료 시 오래된 견적 또는 Backpack 관측부터 비교 완료까지 이 기준을 넘긴 행은 `stale=true`로 표시하고 수익 계산에서 제외합니다. 병렬 요청도 완전히 동일한 순간은 아닙니다.
- 평일 Backpack 값은 공개 참고 가격에 기반한 추정이며 **실제 브로커 RFQ 견적이 아닙니다**. `edgeBasis=reference-price-only-not-executable-RFQ`를 기록합니다. 주말은 실제 매수·매도 수량으로 호가창을 다시 계산하고 부족한 주문량을 배제하지만, 이 역시 동시 체결이나 전송 후 수익을 보장하지 않습니다.
- 네트워크 비용은 기존 `SOL_TX_FEE_USD` 가정으로 별도 계산합니다. V2 대납 비용 등으로 실제 비용과 다를 수 있으며 `costAssumptions`에 가정을 기록합니다. Jupiter 견적에 포함된 교환 수수료는 다시 차감하지 않습니다.

기존 모니터도 출금 후 실제 수량의 매도 견적을 사용하도록 변경했습니다. 새 `gaps.jsonl` 행은 `pricingVersion=2`, `dexSellShares`, `dexSellUsdcOut`을 포함합니다. 이전 행과 같은 계산 버전으로 합산하지 마세요.

`JUPITER_MODE=v2`로 기존 실행기를 사용할 때는 V2 `/order`의 거래를 V2 `/execute`로 보내도록 연결했습니다. `build`는 현재 비교 전용이며, 개별 DEX 실행기를 완성한 것은 아닙니다. 기존 `--provider=raydium`도 견적 조회 옵션이므로 Jupiter 실행기를 Raydium 전용으로 바꾸지 않습니다. 실제 자산을 이동시키는 검증은 이번 변경에서 수행하지 않았습니다.

검증: `npm test` (네트워크·거래 API는 모의 응답으로 대체).

공식 근거: [V2 통합 견적](https://developers.jup.ag/docs/swap/order-and-execute), [DEX 제한 Build API](https://developers.jup.ag/docs/api-reference/swap/build), [V1→V2 변경점](https://developers.jup.ag/docs/swap/migration/metis-to-build). 확인일 2026-09-11.

### Backpack 실제 매도 RFQ와 비교

```bash
node src/cli.js compare SPCX.US --qty=1 \
  --dexes="Raydium CLMM,Meteora DLMM" \
  --taker=YOUR_PUBLIC_ADDRESS --bp-rfq
```

`--bp-rfq`는 평일에 DEX 매수 견적의 **실제 수령 예정 수량**으로 Backpack
`Ask` RFQ를 `AwaitAccept` 모드로 요청합니다. 응답의 `bidPrice`를 사용하고 요청을
취소합니다. 주문 수락이나 자산 이동은 하지 않지만, 인증된 RFQ 요청은 생성합니다.
Backpack API 키와 서명이 필요하며, 요청 단계에서 Backpack 계정 잔고나 세션별
수량 제한으로 거절될 수 있습니다. 이 경우 참고 가격으로 대체하지 않고 `A_bps`를
비웁니다. 매수 RFQ는 요청하지 않으므로 이 모드의 평일 `B_bps`도 비워 둡니다.
주말에는 기존 공개 호가창 비교를 유지합니다.

`validA`는 DEX 매수 → Backpack 매도 방향의 관측 유효성입니다. 반대 방향의
Jupiter 매도 견적이 실패해도 매수 견적과 Backpack RFQ가 유효하면 A를 계산합니다.
`valid`는 기존 양방향 DEX 견적 유효성입니다. RFQ 요청 수량, 가격, 관측 시각,
만료 시각, 취소 결과와 실패 이유는 `data/quotes.compare.jsonl`에 기록합니다.
RFQ 대기까지 포함한 관측 시간이 `--max-age`(기본 5000ms)를 넘으면 계산에서 제외합니다.

수익은 여전히 비용 설정에 따른 추정치입니다. RFQ는 조회 후 취소되므로 입금 후
가격을 보장하지 않으며, 실제 정산 금액·추가 비용은 체결로 검증하지 않았습니다.
2026-09-11 실제 1주 기준 호출에서는 DEX 견적을 받았으나 Backpack 매도 RFQ가
`INSUFFICIENT_FUNDS`로 거절되어 매도 가격과 차익을 산출하지 못했습니다.

API 근거: https://docs.backpack.exchange/ (`Submit RFQ`, `Get RFQs`, `Cancel RFQ`).
