# Backpack의 통합은 무엇을 연결하고, 어떤 분리는 남기는가

조사일: 2026년 9월 12일. 공식 제품·개발 문서와 저장소의 9월 11일 실험 기록을 비교했다. 외부 서비스에 신규 가입하거나 거래하지 않았으며, UI 비교는 공식 이용 안내에 명시된 단계에 근거한다. 현재 문서가 과거에도 동일했다는 점까지 검증하지는 않았다.

**판단: Backpack은 기존에도 있던 전환 기능을 이용자의 입출금·거래 경로에 통합한다. 하지만 다른 서비스와의 차이를 UI만의 차이로 축소할 수는 없다. 전환에 접근하는 자격, 입금 뒤의 보유 형태, 거래·이전 가능한 도착지가 함께 달라진다.**

**1. 먼저 비교 대상을 같은 수준으로 맞춰야 한다**

Backpack은 이용자용 서비스, xStocks는 발행 상품 및 유통 생태계, xPort는 그 안의 현물 발행·상환 경로다. 세 이름을 곧바로 비교하면 일반 이용자의 거래 기능과 전환 참여자의 기능을 섞게 된다.

| 비교 경로 | 이용자에게 드러나는 준비·조작 | 토큰을 보낸 다음 도착지 | 분리가 드러나는 곳 |
| --- | --- | --- | --- |
| Backpack 지원 토큰 입금 | 지원 지역의 인증 계정, 주식 거래 약관 동의, 지원 토큰 입금 | Backpack 내 증권 보유분, 이어서 주식 거래 | 계정·조작은 통합되지만 권리 형태와 거래·정산 조건은 구분 |
| Kraken의 일반 xStocks 이용 | xStocks 매수·매도, 지원 지갑으로 토큰 입출금 | xStocks 토큰 거래 경로 | 일반 거래 기능과 기초 주식 전환 권한 사이 |
| xPort·Alpaca 전환 참여 | 발행사·Alpaca 등록, 계정 연결, 등록 지갑 사용 | Alpaca 계좌의 기초 주식 | 초기 자격·계정·기관 역할에서 분리, 등록 후 전환은 자동화 |
| EXOD의 Superstate→Securitize→브로커 안내 경로 | Burn 절차, 이전 서류, 증권사 이전 요청 | Superstate 장부상 주식 → Securitize → 브로커 계좌 | 보유 형식 전환과 매도할 증권사로의 이전이 별도 작업 |

표의 근거: [Backpack 이용 자격](https://support.backpack.exchange/backpack-securities/eligibility-and-access), [Backpack 전환](https://support.backpack.exchange/backpack-securities/tokenized-securities/conversion-flow), [Kraken FAQ](https://support.kraken.com/articles/xstocks-faq), [xPort](https://docs.xstocks.fi/docs/issuance-and-redemption/in-kind-flow-xport), [Alpaca AP 연동](https://docs.alpaca.markets/us/docs/tokenization-guide-for-authorized-participant), [EXOD 이전 안내](https://www.exodus.com/support/en/articles/12582935-how-do-i-tokenize-my-shares-on-solana-through-superstate).

**2. Backpack도 증권사·수탁·토큰 권리가 하나가 된 것은 아니다**

Backpack은 인증을 마친 적격 이용자에게 별도 주식 계정 개설·추가 인증 없이 약관 동의로 거래를 제공한다고 안내한다. 지원 토큰 입금에 증권 보유분 전환을 포함한다. 이용자가 발행사와 증권사 계정을 따로 연결하는 단계를 공식 일반 이용 경로에 제시하지 않는다는 점이 통합의 구체적 내용이다. [이용 자격](https://support.backpack.exchange/backpack-securities/eligibility-and-access), [전환 안내](https://support.backpack.exchange/backpack-securities/tokenized-securities/conversion-flow)

그러나 공식 설명상 지갑의 토큰은 기초 자산을 가진 SPV에 대한 청구권이고, 계정의 증권 보유분은 UCC Article 8의 security entitlement다. 같은 가격 노출을 유지하도록 설계된 두 형태라도 권리 구조는 구분된다. 증권 서비스에는 Backpack Securities Global Limited, Atomic Vault Securities, RQD Clearing이 각기 소개·중개·청산 및 수탁 역할로 등장한다. 이는 서비스의 공시 내용이며, 이번 실험이 법적 효력이나 실제 수탁 장부를 독립 검증한 것은 아니다. [보유 형태 비교](https://support.backpack.exchange/backpack-securities/tokenized-securities), [기관과 권리 구조](https://support.backpack.exchange/backpack-securities/real-ownership-and-legal-framework)

또한 “Backpack 내부 시장에서 판다”는 표현은 세션을 구분하지 않으면 부정확하다. API 문서는 시장 세션 중 브로커 RFQ, 시장 시간 밖 일부 종목의 자체 호가창을 구분한다. 브로커 RFQ에는 수락·자금 잠금 이후 반대 거래가 실행되면 정산하는 별도 단계가 있다. 같은 화면에서 진행된다는 것과 거래가 모두 내부 호가창에서 끝난다는 것은 다르다. [Backpack API — Stock Trading / Deferred settlement](https://docs.backpack.exchange/#tag/Stock-Trading)

기능 제공 범위에도 경계가 있다. 토큰 설명의 비교표에는 외부 증권사 이전과 현금 배당이 지원되는 것으로 요약되지만, 상세 FAQ는 ACATS 이전과 현금 배당 지급이 아직 제공되지 않는다고 명시한다. 따라서 “증권 인프라가 지원한다”를 “현재 계정에서 바로 이용할 수 있다”로 옮겨 쓰면 안 된다. [보유 형태 비교](https://support.backpack.exchange/backpack-securities/tokenized-securities), [현재 기능 FAQ](https://support.backpack.exchange/backpack-securities/faqs)

**3. xStocks의 핵심 분리는 화면보다 거래 참여자와 전환 참여자의 권한에 있다**

Kraken의 일반 안내는 xStocks의 매매와 지갑 출금을 제공하면서, 토큰을 IBKR 같은 전통 증권계좌로 직접 이전할 수 없다고 설명한다. 반면 xPort는 발행사와 Alpaca에 등록한 참여자가 토큰을 기초 주식으로 상환할 수 있다고 설명한다. 일반 거래소 이용 경로와 별도의 현물 상환 경로에 대한 설명으로 구분해야 하며, 한쪽을 근거로 다른 쪽의 기능까지 부정해서는 안 된다. [Kraken FAQ](https://support.kraken.com/articles/xstocks-faq), [xPort](https://docs.xstocks.fi/docs/issuance-and-redemption/in-kind-flow-xport)

발행사 플랫폼에는 별도 계정·API 키·처리 상태·거래 이력이 있다. Alpaca의 AP 가이드는 발행사의 승인, 자기 명의 Alpaca 계좌, 양쪽 계정 연결을 요구한다. 다만 이것만으로 xPort가 모든 경우에 기관 전용이라고 단정할 수는 없다. 확인한 것은 별도의 등록·승인 경로이며, 보통의 거래소 계정만으로 이 권한이 자동 부여된다는 근거는 없다. [발행사 플랫폼](https://docs.xstocks.fi/docs/issuance-and-redemption), [AP 가이드](https://docs.alpaca.markets/us/docs/tokenization-guide-for-authorized-participant)

xPort의 초기 준비가 끝난 뒤에는 발행사가 토큰 입금을 처리하고 Alpaca가 기초 주식을 계좌에 돌려주는 과정이 자동화된다. 여러 기관이 등장한다고 매번 여러 화면에서 수작업해야 한다는 뜻은 아니다. 공개 문서로 로그인 후 실제 화면 수나 클릭 수까지 비교하지는 못했다. [xPort 전환 순서](https://docs.xstocks.fi/docs/issuance-and-redemption/in-kind-flow-xport)

더 직접적인 근거는 xStocks의 거래소 연동 문서다. 거래소는 발행사에 직접 등록하거나, 이미 등록된 시장조성자에게 유동성 공급을 맡길 수 있다. 후자의 경우 발행·상환은 시장조성자가 담당한다. 일반 이용자는 간단한 매수·매도 화면만 보더라도, 뒤에서는 별도의 참여자가 토큰 공급을 조절할 수 있다는 뜻이다. 이는 가능한 연동 모델의 설명이며 특정 거래소가 어느 모델로 운영되는지까지 확인한 것은 아니다. [Exchange Integration](https://docs.xstocks.fi/docs/exchange-integration)

여기서 도출되는 해석은 다음과 같다. **토큰을 거래하는 시장에 참여하는 권한과, 토큰을 기초 주식으로 전환해 두 시장을 잇는 권한은 다를 수 있다.** 같은 토큰을 CEX와 DEX에서 사고파는 거래 자체가 반드시 xPort를 거쳐야 하는 것은 아니다. xPort의 승인 조건은 기초 주식과의 발행·상환 경로를 이용하려 할 때 비교해야 한다.

권리 비교도 단계별로 해야 한다. xStocks 토큰은 공식적으로 tracker certificate인 무기명 채무증권으로 설명된다. Backpack의 전환 후 security entitlement와 xStocks의 전환 전 토큰만 비교하면 비교 단계가 어긋난다. 토큰 대 토큰, 전환 후 증권 보유분 대 증권 보유분을 나눠야 한다. [xStocks 법적 분류](https://docs.xstocks.fi/docs/product-legal-overview)

**4. EXOD의 특정 경로에서는 운영 단계 자체의 분리가 더 크다**

공식 안내는 Solana EXOD 토큰을 Superstate에서 장부상 주식으로 바꾸고, 서류로 Securitize에 이전한 뒤, 증권사가 계좌 이전을 시작하도록 요청하게 한다. Securitize→증권사 이전만 통상 약 5영업일이다. 여기서는 토큰 전환 완료가 매도할 계좌에 자산이 도착했다는 뜻이 아니다. 이 특정 경로는 “서비스가 나뉘어 보이는 정도”를 넘어 이용자의 작업과 자산 이전이 단계별로 나뉘는 사례다. 모든 Superstate·Securitize 상품이나 가능한 기관 경로에 일반화하지 않는다. [EXOD 절차](https://www.exodus.com/support/en/articles/12582935-how-do-i-tokenize-my-shares-on-solana-through-superstate)

**5. 이번 실험과 연결할 논지**

Backpack에서 약 1주 매도 RFQ가 잔고 부족으로 실패했고, 입금 후 0.01359주 매도는 성공했다. 이어 0.01주를 확보한 상태에서는 같은 수량의 RFQ를 10회 받고 취소했다. 이는 전환과 매도 경로가 열려 있어도 요청 수량에 맞는 사전 잔고 등 실행 조건이 남는다는 근거다. 실패와 성공은 시간·수량도 달라 잔고만의 효과를 분리한 실험은 아니다. [실패 기록](../data/quotes.compare.jsonl), [매도 기록](../data/spcx-v2-2usdc-20260911.json), [후속 10회 관측](rfq-paired-observation-2026-09-11.md)

이 잔고 조건을 RWA 전체나 xPort에 공통된 현상으로 옮기면 안 된다. Alpaca에는 매매 주문과 별도의 최우선 매수·매도 시장정보 API가 있다. 문서상 이 요청에는 인증·데이터 피드 조건이 있고 주문 수량·계정 보유 수량을 입력하지 않는다. 그러나 그 데이터는 특정 수량에 대한 체결 보장 RFQ와 같지 않다. “가격을 볼 수 있는가”와 “그 가격으로 그 수량을 팔 수 있는가”를 구분해야 비교가 성립한다. [Alpaca Latest quotes](https://docs.alpaca.markets/us/reference/stocklatestquotes-1)

아티클에 쓸 수 있는 결론:

> Backpack이 보여주는 변화는 토큰과 주식 사이의 전환을 처음 만든 데 있지 않다. 별도 등록·계정 연결이 드러나는 xPort 경로와 달리, 지원 토큰의 전환과 증권 매도를 적격 기존 이용자의 입출금·거래 흐름에 포함한다는 점에 있다. 다른 서비스에서도 기관의 역할은 간단한 거래 화면 뒤에 숨겨질 수 있지만, 그 화면을 쓰는 이용자에게 기초 주식 전환 권한까지 주어지는지는 별개의 문제다.
>
> 그렇다고 Backpack에서 모든 경계가 사라지는 것은 아니다. 토큰과 계정 보유분은 권리 형태가 다르고, 전환 반영·견적 요청·거래 정산도 서로 다른 단계다. 우리는 전환 후 매도까지 성공했지만, 요청 수량에 충분한 잔고가 없을 때는 매도 견적을 받지 못했다. 따라서 이 실험의 의미는 ‘차이는 UX뿐이다’가 아니라, **서비스가 시장 연결을 이용하기 쉽게 만들더라도, 그 연결을 누가 어떤 조건으로 가격 비교와 거래에 활용할 수 있는지는 따로 살펴봐야 한다**는 데 있다.

검증의 한계: Backpack 약관의 Google Drive 원문 3종은 이번 조회에서 열리지 않았다. 법인·권리 설명은 공개 지원 문서와 API 문서 기준이며 약관 전체에 대한 법률 검토가 아니다. 외부 서비스의 가입 승인 가능성, 실제 화면 수, 동일 종목·수량에서의 처리 속도·비용은 실측하지 않았다. 원래 짧은 아티클은 이 조사 과정에서 수정하지 않았다.
