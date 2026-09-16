# 토큰을 입금하면, 어떤 권리를 갖게 될까요?

> Solana–Backpack 차익거래 실험에서 출발해 토큰이 증권계좌로 연결되는 과정을 살펴봅니다

- 작성: M3M3 / 이주호
- 기준일: 실험 2026년 9월 11일 / 문서 조사 9월 12–13일
- 공통 주제: 토큰화 주식은 어떻게 증권계좌와 연결되는가 — 전환 권한과 상환 구조가 만드는 시장의 차이

## 팔 가격을 물었는데, 잔고가 필요했습니다

저희 팀은 Solana 블록체인에서 거래되는 토큰과 Backpack의 주식 가격을 비교하는 도구를 만들었습니다. 한쪽에서 싸게 사서 다른 쪽으로 옮겨 비싸게 파는 차익거래를 시도해 보기 위해서였습니다. Backpack에 주목한 이유는 지원하는 토큰을 입금하면 계정의 주식 보유분으로 바뀌고, 같은 서비스에서 이어서 팔 수 있다고 안내했기 때문입니다. [Backpack 전환 안내](https://support.backpack.exchange/backpack-securities/tokenized-securities/conversion-flow)

9월 11일에는 Solana에서 살 수 있는 SPCX 토큰 수량을 확인한 뒤, 그만큼을 Backpack에서 팔면 얼마를 받을 수 있는지 물었습니다. 이렇게 거래를 중개하는 곳에 수량을 알려 주고 가격을 받는 방식을 **RFQ**라고 합니다. 그런데 약 1주를 팔기 위한 요청이 **잔고 부족**으로 거절됐습니다. 저희가 사용한 경로에서는 실제로 팔겠다고 수락하기 전, 견적을 요청하는 단계부터 잔고가 문제가 됐습니다. [견적 요청 기록](../data/quotes.compare.jsonl)

자산을 입금한 뒤에는 거래가 가능했습니다. 앞선 9월 9일에는 약 0.02주에 해당하는 토큰을 Backpack에 입금해 일부를 팔고, 일부는 다시 출금해 Solana에서 팔았습니다. 9월 11일에도 이후 입금한 소액을 파는 데 성공했습니다. 별도로 0.01주를 마련한 뒤에는 같은 수량의 매도 가격을 **10회** 받아 보고, 거래하지 않고 요청을 취소했습니다. 실패한 때와 성공한 때는 수량과 시간대도 달랐습니다. 다만 입금해서 팔 수 있다는 것과, 입금하기 전에 원하는 수량의 판매 가격을 알 수 있다는 것은 다른 조건이라는 점이 드러났습니다. [실험 기록](project-report.md), [후속 가격 조회](rfq-paired-observation-2026-09-11.md)

Backpack의 증권 서비스 약관에는 계정 자산이 부족하면 거래를 진행하지 않을 수 있다는 조건이 있습니다. 다만 **견적을 받는 단계부터 잔고를 요구하는 이유**는 공개 자료에서 확인하지 못했습니다. 이 검사가 Backpack의 자체 정책인지, 연결된 증권사의 요구인지도 확인되지 않았습니다. [증권 서비스 약관 3.1항](https://drive.google.com/file/d/1kcQfez-1YNcmoaIRXzDt4zvwTG1dd-d5/view), [추가 조사](rfq-balance-policy-review-2026-09-13.md)

이 일을 계기로 먼저 **Backpack에서 ‘팔 수 있는 잔고’가 무엇인지** 살펴봤습니다. 공식 설명에 따르면 지원 토큰을 입금하는 과정에는, 지갑의 토큰을 계정의 주식 보유분으로 전환하는 처리가 포함되어 있었습니다. 입금 버튼 하나로 이어지는 이 과정에서 무엇을 보유하게 되고, 그 변화를 누가 처리하는지가 궁금해졌습니다. [Backpack 전환 안내](https://support.backpack.exchange/backpack-securities/tokenized-securities/conversion-flow)

이 글에서는 Backpack과 함께 xStocks의 xPort·Alpaca, EXOD의 Superstate·Securitize 전환 절차를 살펴봅니다. 직접 거래한 곳은 Solana와 Backpack입니다. 다른 서비스는 공식 문서로 조사했으며, 어느 쪽에서 차익거래가 더 잘되는지를 비교한 실험은 아닙니다.

## 입금하면 토큰을 보유하는 방식도 달라집니다

Backpack의 설명에 따르면, 지갑의 토큰은 그에 연결된 주식을 보유하는 별도 회사에 대한 **청구권**입니다. 청구권은 그 회사에 약속된 처리를 요구할 수 있는 권리라는 뜻입니다. 여기서는 토큰을 정해진 절차에 따라 돌려주고, 그에 해당하는 주식을 계정에 반영받는 전환으로 이어집니다. [토큰과 주식 보유 방식](https://support.backpack.exchange/backpack-securities/tokenized-securities)

이런 구조에서 회사를 따로 두는 이유는 특정 자산과 관련 업무를 맡을 주체를 정하고, 다른 사업의 자산이나 위험과 구분해 다루기 위해서입니다. 이를 특수목적법인(SPV)이라고 부릅니다. 토큰 보유자는 주식을 자신의 증권계좌에 보유하는 대신, 그 주식을 보유한 회사에 대한 권리를 토큰으로 갖는 셈입니다. 이 설명은 별도 법인을 사용하는 일반적인 취지이며, Backpack의 구체적인 책임 범위는 해당 상품의 약관에 따라 정해집니다. [특수목적법인의 취지 — IMF](https://www.imf.org/external/pubs/ft/bop/2020/pdf/20-26.pdf), [Backpack의 보유 형태 설명](https://support.backpack.exchange/backpack-securities/tokenized-securities)

지원 토큰을 Backpack에 입금하면, 공식 설명상 보유 형태는 **증권계좌를 통해 주식을 보유하는 권리**로 바뀝니다. 약관은 여러 이용자의 주식을 모아 보관하고, 각 이용자의 몫을 내부 장부에 따로 기록한다고 설명합니다. 이렇게 계정에 주식 보유분이 기록될 때 생기는 권리를 *security entitlement*라고 부릅니다. 지갑에서 토큰을 갖고 있는 것과 서비스 계정에 주식 보유분이 기록되는 것은 구분되며, **입금과 전환이 이 두 보유 형태를 이어 줍니다.** [증권 서비스 약관 4.3–4.4·5.2항](https://drive.google.com/file/d/1kcQfez-1YNcmoaIRXzDt4zvwTG1dd-d5/view), [입금과 전환](https://support.backpack.exchange/backpack-securities/tokenized-securities/conversion-flow)

이를 처리하는 곳도 하나가 아닙니다. Backpack의 안내에는 이용자를 증권 서비스에 연결하는 회사, 주식 거래를 중개하는 회사, 거래 후 돈과 주식을 주고받는 처리를 맡고 자산을 보관하는 회사가 나뉘어 있습니다. 이용자는 Backpack 계정 하나를 쓰지만, 뒤에서는 여러 기관이 역할을 나눠 맡습니다. [기관별 역할](https://support.backpack.exchange/backpack-securities/real-ownership-and-legal-framework)

판매 과정에도 이런 분담이 남아 있습니다. Backpack의 개발 문서에 따르면 주식시장 거래 시간에는 중개업체가 가격을 제시하고, 이용자가 수락하면 그 업체가 반대편 거래를 진행한 뒤 거래 결과를 계정에 반영합니다. 시장 시간 밖 일부 종목은 Backpack 안의 매수·매도 주문을 모은 호가창에서 거래됩니다. 같은 화면에서 팔더라도 시간과 종목에 따라 거래가 처리되는 방식은 달라집니다. [Backpack 거래 방식](https://docs.backpack.exchange/)

저희가 직접 확인한 것은 토큰이 이동하고, 계정에 수량이 반영되고, 그 수량을 팔 수 있었다는 사실입니다. 실제 주식이 보관된 장부나 기관 사이의 처리 내역까지 들여다본 것은 아니므로, 그 뒤의 구조는 공식 설명을 바탕으로 이해했습니다.

## 다른 서비스에서는 어떤 절차를 거칠까요?

토큰을 주식으로 바꾸는 기능은 다른 곳에도 있습니다. 다만 **누가 이용할 수 있는지, 바꾼 뒤 어디에 주식이 기록되는지, 그곳에서 바로 팔 수 있는지**가 다릅니다.

| 경로 | 먼저 준비할 것 | 전환 후 판매까지의 흐름 |
| --- | --- | --- |
| **Backpack** | 지원 지역의 본인 인증 계정, 주식 거래 약관 동의 | 지원 토큰을 입금하면 계정의 주식 보유분으로 반영되고 같은 서비스에서 판매 |
| **xPort·Alpaca** | 토큰 발행사와 증권사 등록, 계정 연결, 사용할 지갑 등록 | 발행사가 토큰을 받고 Alpaca가 주식을 증권계좌에 반영한 뒤 판매 |
| **EXOD의 Superstate·Securitize 경로** | 관련 계정과 지갑 등록, 주식을 옮기기 위한 서류 | Superstate에서 주식으로 기록한 뒤 Securitize를 거쳐 판매할 증권사 계좌로 이전 |

Backpack은 이용 가능한 지역에서 본인 인증을 마친 기존 이용자라면, 별도의 주식 계정을 만들거나 인증을 다시 받지 않고 약관에 동의해 거래할 수 있다고 설명합니다. 지원 토큰을 주식으로 바꾸는 일도 평소의 입금 절차에 포함됩니다. 이용자가 여러 기관의 계정을 따로 연결하는 준비를 앞에 내세우지 않는 것입니다. [Backpack 이용 조건](https://support.backpack.exchange/backpack-securities/eligibility-and-access), [전환 절차](https://support.backpack.exchange/backpack-securities/tokenized-securities/conversion-flow)

xStocks의 xPort는 토큰과 그에 연결된 주식을 서로 바꾸는 경로입니다. 이때 토큰 발행사는 토큰을 받는 쪽을, 증권사인 Alpaca는 주식을 계좌에 반영하는 쪽을 맡습니다. 그래서 양쪽에 등록하고 계정을 연결하는 준비가 필요합니다. 저희가 참고한 Alpaca 안내는 발행사로부터 토큰을 만들거나 돌려줄 수 있도록 승인받은 참여자(AP)를 대상으로 합니다. 일반 거래소에 가입했다고 이 승인까지 받은 것은 아닙니다. [xPort](https://docs.xstocks.fi/docs/issuance-and-redemption/in-kind-flow-xport), [Alpaca 참여자 안내](https://docs.alpaca.markets/us/docs/tokenization-guide-for-authorized-participant)

준비가 끝난 뒤에는 xPort도 자동으로 이어집니다. 등록한 지갑에서 지정 주소로 토큰을 보내면, 발행사가 이를 처리하고 Alpaca가 해당 주식을 이용자 계좌에 반영합니다. 회사가 나뉘어 있다는 이유만으로 매번 이용자가 양쪽에 연락하거나 수작업해야 하는 것은 아닙니다. [xPort 전환 순서](https://docs.xstocks.fi/docs/issuance-and-redemption/in-kind-flow-xport)

EXOD의 공식 안내에서는 이용자가 거쳐야 할 단계가 더 남습니다. Superstate에서 토큰을 돌려주면 먼저 주식 소유 기록을 관리하는 장부에 보유분이 반영됩니다. 그러나 그 장부는 곧바로 주식을 파는 거래 화면이 아닙니다. 안내된 경로에서는 서류를 제출해 Securitize로 주식을 옮기고, 다시 판매할 증권사의 계좌로 이전해야 합니다. 마지막 Securitize→증권사 구간만 보통 약 **5영업일**로 안내됩니다. **주식으로 바꾸는 일이 끝나도, 팔 수 있는 계좌에 도착하기까지는 절차가 더 남는 사례**입니다. 이는 EXOD의 해당 경로에 대한 설명입니다. [EXOD 이전 안내](https://www.exodus.com/support/en/articles/12582935-how-do-i-tokenize-my-shares-on-solana-through-superstate)

## 토큰을 살 수 있다고 주식으로 바꿀 수도 있는 것은 아닙니다

Kraken의 일반 xStocks 안내에는 토큰을 전통 증권계좌로 직접 옮길 수 없다고 적혀 있습니다. 앞서 본 xPort의 설명과 다르게 들리지만, 이용하는 경로가 다릅니다. Kraken에서는 토큰을 사고팔고 지갑으로 보낼 수 있습니다. 그 토큰을 주식으로 바꾸려면 xPort처럼 별도로 등록하고 준비한 경로를 이용해야 합니다. **토큰을 거래할 수 있는 자격과 주식으로 바꿀 수 있는 자격이 나뉘는 것입니다.** [Kraken 안내](https://support.kraken.com/articles/xstocks-faq), [xPort](https://docs.xstocks.fi/docs/issuance-and-redemption/in-kind-flow-xport)

이 분담은 일반 이용자의 화면에 보이지 않을 수도 있습니다. xStocks는 거래소가 토큰 발행사에 직접 등록하거나, 이미 등록된 전문 거래업체에 토큰 발행·회수와 매수·매도 물량 공급을 맡길 수 있다고 설명합니다. 이용자가 간단한 구매 버튼을 누르는 동안, 뒤에서는 다른 참여자가 주식과 토큰 사이의 물량을 맞출 수 있습니다. 따라서 Backpack과 비교할 때도 화면이 간단한지만 볼 수는 없습니다. **그 화면을 쓰는 이용자에게 주식으로 바꾸는 경로까지 함께 열려 있는지**를 살펴봐야 합니다. [xStocks의 거래소 연결 방식](https://docs.xstocks.fi/docs/exchange-integration)

무엇을 보유하는지도 전환 전후를 나눠 봐야 합니다. xStocks의 공식 설명은 토큰을 주식 자체의 직접 소유와 구분하고, 주식 가격에 연동되는 증서로 설명합니다. 이 토큰 상태를 Backpack에서 이미 주식으로 전환된 계정 보유분과 비교하면 서로 다른 단계를 비교하게 됩니다. 지갑에 있을 때의 권리와 증권계좌로 바꾼 뒤의 권리를 각각 맞춰 봐야 합니다. [xStocks의 상품 설명](https://docs.xstocks.fi/docs/product-legal-overview)

주식으로 기록된 뒤에도 서비스가 제공하는 기능에는 차이가 있습니다. 조사 시점의 Backpack 상세 안내에는 다른 증권사 계좌로 주식을 옮기는 기능이 아직 제공되지 않는다고 적혀 있습니다. 주식을 보유하게 됐다는 것과 그 주식을 원하는 증권사로 바로 옮길 수 있다는 것은 별개의 문제입니다. [Backpack 이용 안내](https://support.backpack.exchange/backpack-securities/faqs)

## 입금 버튼 뒤에 무엇이 연결되어 있는지 살펴봤습니다

저희의 출발점은 팔 가격을 알아보려다 받은 잔고 부족 응답이었습니다. 견적 단계에서 잔고를 요구하는 이유는 여전히 확인하지 못했지만, ‘팔 수 있는 잔고’를 살펴보면서 조사할 대상이 구체적으로 드러났습니다. Backpack의 공식 설명에서 토큰 입금은 주식 보유분을 계정에 기록하는 전환으로 이어졌습니다. 그래서 다른 서비스에서도 **토큰을 주식으로 바꾸는 일과, 그 주식을 팔 수 있게 되는 일이 어떻게 연결되는지** 조사했습니다. [잔고 조건 조사와 확인 범위](rfq-balance-policy-review-2026-09-13.md), [서비스별 구조 조사](market-connection-structure-review-2026-09-12.md)

비교 결과, Backpack은 지원 토큰을 주식으로 바꾸고 파는 과정을 기존 이용자의 입출금과 거래 안에 포함하고 있었습니다. xPort도 주식 전환을 제공하지만 발행사와 증권사에 별도로 등록하고 연결하는 준비가 필요했습니다. EXOD의 안내 경로에서는 주식으로 바꾼 뒤에도 판매할 증권사로 옮기는 절차가 남았습니다.

**같은 ‘토큰을 주식으로 바꾼다’는 설명이라도, 누가 이용할 수 있고 어디까지 처리해 주는지는 다릅니다.** Backpack에서 입금과 판매가 간단하게 이어지는 이유도 여러 기관의 역할이 없어서가 아니라, 그 역할을 이용자 대신 연결해 제공하기 때문이라고 이해할 수 있습니다. 이 글에서 살펴본 것은 바로 그 연결입니다. 토큰이 어느 지갑에서 어느 계정으로 이동하는지를 넘어, 그 과정에서 이용자가 무엇을 보유하게 되고 어디에서 팔 수 있게 되는지를 비교했습니다.
