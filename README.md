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
- 평일 RFQ 경로는 두 기준을 같이 기록한다. **기대(exp)**: 브로커 정산가 ≈ 미국 시장 최근가(9/9 실체결 9건에서 견적 중간값 ±5 bps). **보수(cons)**: 견적 bid/ask(±15 bps). 기회 플래그는 기대 기준 순수익이 `EDGE_BPS + RFQ_SETTLE_VAR_BPS` 이상일 때, 호가창 경로는 `EDGE_BPS` 이상일 때.
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
src/dex/jupiter.js       price v3, /swap/v1 quote+swap, /ultra/v1 order+execute
src/dex/raydium.js       compute/swap-base-in, 풀 목록
src/session.js           ET 세션 판정 + market-holidays
src/pricing.js           VWAP·견적 → 양방향 순수익
src/monitor.js           수집 루프/JSONL 기록
src/executor.js          preflight / plan / 실행(dry 기본, --live 게이트)
src/solana/wallet.js     키 로드, Token-2022 전송(ATA idempotent), 서명·전송
```
