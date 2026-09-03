/**
 * O CATÁLOGO — importado por quem executa E por quem descreve.
 *
 * As funções entram no registro por efeito de import. Enquanto essa lista viveu só dentro de
 * `functionExecutor`, o manifesto do arquiteto listava o que por acaso já tivesse sido
 * carregado por outro caminho: pedir um plano antes de qualquer execução deixava
 * `calculate_rsi` de fora, e o compilador declarava "nenhuma função registrada faz este
 * cálculo" para a única conta que ele sabe fazer com exatidão — devolvendo o RSI para o
 * modelo adivinhar.
 *
 * Este arquivo é a lista, e é PURO: nenhum dos quatro módulos abre banco. É o que permite
 * importá-lo do caminho do manifesto sem arrastar `db.js`, que estoura no load quando não há
 * `MONGODB_URI`.
 */
import './liveDataFunctions.js'
import './dataHistoryFunctions.js'
import './realtimeDataFunctions.js'
import './indicatorFunctions.js'
