import * as sapling from '@airgap/sapling-wasm'
import sodium = require('libsodium-wrappers')
import { Domain, TezosUtils } from '../../..'

import BigNumber from '../../../dependencies/src/bignumber.js-9.0.0/bignumber'
import { mnemonicToSeed } from '../../../dependencies/src/bip39-2.5.0'
import { BalanceError, ProtocolErrorType } from '../../../errors'
import { AirGapTransactionStatus, IAirGapTransaction } from '../../../interfaces/IAirGapTransaction'
import { RawTezosSaplingTransaction, RawTezosTransaction } from '../../../serializer-v3/types'
import { SignedTezosTransaction } from '../../../serializer/schemas/definitions/signed-transaction-tezos'
import { UnsignedTezosTransaction } from '../../../serializer/schemas/definitions/unsigned-transaction-tezos'
import { UnsignedTezosSaplingTransaction } from '../../../serializer/schemas/definitions/unsigned-transaction-tezos-sapling'
import { flattenArray } from '../../../utils/array'
import { ProtocolSymbols } from '../../../utils/ProtocolSymbols'
import { CurrencyUnit, FeeDefaults, ICoinProtocol } from '../../ICoinProtocol'
import { ICoinSubProtocol } from '../../ICoinSubProtocol'
import { NonExtendedProtocol } from '../../NonExtendedProtocol'
import { TezosContract } from '../contract/TezosContract'
import { TezosContractCall } from '../contract/TezosContractCall'
import { TezosAddress } from '../TezosAddress'
import { TezosProtocol } from '../TezosProtocol'
import { TezosProtocolConfig, TezosProtocolOptions } from '../TezosProtocolOptions'
import { MichelsonAddress } from '../types/michelson/primitives/MichelsonAddress'
import { TezosOperation } from '../types/operations/TezosOperation'
import { TezosTransactionOperation, TezosTransactionParameters } from '../types/operations/Transaction'
import { TezosSaplingCiphertext } from '../types/sapling/TezosSaplingCiphertext'
import { TezosSaplingInput } from '../types/sapling/TezosSaplingInput'
import { TezosSaplingOutput } from '../types/sapling/TezosSaplingOutput'
import { TezosSaplingStateDiff } from '../types/sapling/TezosSaplingStateDiff'
import { TezosSaplingStateTree } from '../types/sapling/TezosSaplingStateTree'
import { TezosSaplingTransaction } from '../types/sapling/TezosSaplingTransaction'
import { TezosSaplingTransactionCursor } from '../types/sapling/TezosSaplingTransactionCursor'
import { TezosSaplingTransactionResult } from '../types/sapling/TezosSaplingTransactionResult'
import { TezosOperationType } from '../types/TezosOperationType'
import { TezosWrappedOperation } from '../types/TezosWrappedOperation'

import { TezosSaplingNodeClient } from './node/TezosSaplingNodeClient'
import { TezosSaplingAddress } from './TezosSaplingAddress'
import { TezosSaplingCryptoClient } from './TezosSaplingCryptoClient'
import { TezosSaplingProtocolOptions } from './TezosSaplingProtocolOptions'
import { TezosSaplingBookkeeper } from './utils/TezosSaplingBookkeeper'
import { TezosSaplingEncoder } from './utils/TezosSaplingEncoder'
import { TezosSaplingForger } from './utils/TezosSaplingForger'
import { TezosSaplingState } from './utils/TezosSaplingState'

export abstract class TezosSaplingProtocol extends NonExtendedProtocol implements ICoinProtocol {
  public readonly symbol: string
  public readonly name: string
  public readonly marketSymbol: string

  public readonly feeSymbol: string
  public readonly feeDefaults: FeeDefaults

  public readonly decimals: number
  public readonly feeDecimals: number

  public readonly identifier: ProtocolSymbols
  public readonly units: CurrencyUnit[]

  public readonly supportsHD: boolean = false
  public readonly standardDerivationPath: string

  public readonly addressIsCaseSensitive: boolean = true
  public readonly addressValidationPattern: string = '^(zet1[1-9A-Za-z]{65}|tz1[1-9A-Za-z]{33})$'
  public readonly addressPlaceholder: string = 'zet1...'

  public readonly cryptoClient: TezosSaplingCryptoClient
  public readonly nodeClient: TezosSaplingNodeClient
  public readonly contract: TezosContract

  public readonly bookkeeper: TezosSaplingBookkeeper
  public readonly encoder: TezosSaplingEncoder
  public readonly forger: TezosSaplingForger
  public readonly state: TezosSaplingState

  protected readonly tezosProtocol: TezosProtocol

  constructor(public readonly options: TezosSaplingProtocolOptions) {
    super()

    this.tezosProtocol = new TezosProtocol(new TezosProtocolOptions(this.options.network, new TezosProtocolConfig()))

    this.name = options.config.name
    this.symbol = options.config.symbol ?? this.tezosProtocol.symbol
    this.marketSymbol = options.config.marketSymbol ?? this.tezosProtocol.marketSymbol

    this.feeSymbol = this.tezosProtocol.feeSymbol
    this.feeDefaults = options.config.feeDefaults ?? this.tezosProtocol.feeDefaults

    this.decimals = options.config.decimals ?? this.tezosProtocol.decimals
    this.feeDecimals = this.tezosProtocol.feeDecimals

    this.identifier = options.config.identifier ?? this.tezosProtocol.identifier
    this.units = this.options.config.units ?? this.tezosProtocol.units

    this.standardDerivationPath = this.tezosProtocol.standardDerivationPath

    this.cryptoClient = new TezosSaplingCryptoClient(this.tezosProtocol.cryptoClient)
    this.nodeClient = new TezosSaplingNodeClient(this.options.network.rpcUrl, this.options.config.contractAddress)

    this.contract = new TezosContract(this.options.config.contractAddress, this.options.network)

    this.state = new TezosSaplingState(this.options.config.merkleTreeHeight)
    this.encoder = new TezosSaplingEncoder()
    this.forger = new TezosSaplingForger(this.cryptoClient, this.state, this.encoder, this.options.config.externalProvider)
    this.bookkeeper = new TezosSaplingBookkeeper(this.identifier, this.options.network, this.cryptoClient, this.encoder)
  }

  public abstract prepareContractCalls(transactions: string[]): Promise<TezosContractCall[]>
  public abstract parseParameters(parameters: TezosTransactionParameters): Promise<string[]>

  public async initParameters(spendParams: Buffer, outputParams: Buffer): Promise<void> {
    const externalInitParameters = this.options.config.externalProvider?.initParameters
    if (externalInitParameters !== undefined) {
      await externalInitParameters(spendParams, outputParams)
    } else {
      await sapling.initParameters(spendParams, outputParams)
    }
  }

  public async getBlockExplorerLinkForTxId(txId: string): Promise<string> {
    return this.tezosProtocol.getBlockExplorerLinkForTxId(txId)
  }

  public async getPublicKeyFromMnemonic(mnemonic: string, derivationPath: string, password?: string | undefined): Promise<string> {
    const seed: Buffer = this.getSeedFromMnemonic(mnemonic, password)

    return this.getPublicKeyFromHexSecret(seed.toString('hex'), derivationPath)
  }

  public async getPrivateKeyFromMnemonic(mnemonic: string, derivationPath: string, password?: string | undefined): Promise<Buffer> {
    const seed: Buffer = this.getSeedFromMnemonic(mnemonic, password)

    return this.getPrivateKeyFromHexSecret(seed.toString('hex'), derivationPath)
  }

  private getSeedFromMnemonic(mnemonic: string, password?: string | undefined): Buffer {
    const seed: Buffer = mnemonicToSeed(mnemonic, password)

    // We xor the two halves of the BIP-39 seed, as does `tezos-client`
    const first32: Buffer = seed.slice(0, 32)
    const second32: Buffer = seed.slice(32)

    return Buffer.from(first32.map((byte, index) => byte ^ second32[index]))
  }

  public async getPublicKeyFromHexSecret(secret: string, derivationPath: string): Promise<string> {
    const viewingKey: Buffer = await sapling.getExtendedFullViewingKey(secret, derivationPath)

    return viewingKey.toString('hex')
  }

  public async getPrivateKeyFromHexSecret(secret: string, derivationPath: string): Promise<Buffer> {
    return sapling.getExtendedSpendingKey(secret, derivationPath)
  }

  public async getAddressFromPublicKey(viewingKey: string): Promise<TezosSaplingAddress> {
    return TezosSaplingAddress.fromViewingKey(viewingKey)
  }

  public async getAddressesFromPublicKey(viewingKey: string): Promise<TezosSaplingAddress[]> {
    return [await this.getAddressFromPublicKey(viewingKey)]
  }

  public async getAddressFromViewingKey(viewingKey: string, index: string): Promise<TezosSaplingAddress> {
    return TezosSaplingAddress.fromViewingKey(viewingKey, index)
  }

  public async getNextAddressFromPublicKey(viewingKey: string, current: TezosSaplingAddress): Promise<TezosSaplingAddress> {
    return TezosSaplingAddress.next(viewingKey, current)
  }

  public async getTransactionsFromPublicKey(
    publicKey: string,
    limit: number,
    cursor?: TezosSaplingTransactionCursor
  ): Promise<TezosSaplingTransactionResult> {
    const saplingStateDiff: TezosSaplingStateDiff = await this.nodeClient.getSaplingStateDiff()

    const incoming: TezosSaplingInput[] = []
    const outgoing: TezosSaplingInput[] = []

    let page: number = cursor?.page ?? 0
    let pageStart: number = page * limit
    let pageEnd: number = pageStart + limit

    while (incoming.length + outgoing.length < limit && pageStart < saplingStateDiff.commitments_and_ciphertexts.length) {
      const commitmentsAndCiphertexts: [string, TezosSaplingCiphertext, BigNumber][] = saplingStateDiff.commitments_and_ciphertexts
        .map(
          ([commitment, ciphertext]: [string, TezosSaplingCiphertext], index: number) =>
            [commitment, ciphertext, new BigNumber(index)] as [string, TezosSaplingCiphertext, BigNumber]
        )
        .reverse()
        .slice(pageStart, pageEnd)

      const inputs: [TezosSaplingInput[], TezosSaplingInput[]] = await Promise.all([
        this.bookkeeper.getIncomingInputs(publicKey, commitmentsAndCiphertexts),
        this.bookkeeper.getOutgoingInputs(publicKey, commitmentsAndCiphertexts)
      ])

      incoming.push(...inputs[0])
      outgoing.push(...inputs[1])

      page += 1
      pageStart += limit
      pageEnd += limit
    }

    const airGapIncoming: IAirGapTransaction[] = await Promise.all(
      incoming.map(async (input: TezosSaplingInput) => ({
        from: ['Shielded Pool'],
        to: [input.address],
        isInbound: true,
        amount: input.value,
        fee: '0',
        protocolIdentifier: this.identifier,
        network: this.options.network
      }))
    )

    const airGapOutgoing: IAirGapTransaction[] = await Promise.all(
      outgoing.map(async (input: TezosSaplingInput) => ({
        from: [(await this.getAddressFromPublicKey(publicKey)).getValue()],
        to: [input.address],
        isInbound: false,
        amount: input.value,
        fee: '0',
        protocolIdentifier: this.identifier,
        network: this.options.network
      }))
    )

    return {
      transactions: airGapIncoming.concat(airGapOutgoing),
      cursor: { page: page + 1 }
    }
  }

  public async signWithPrivateKey(privateKey: Buffer, transaction: RawTezosSaplingTransaction): Promise<string> {
    const stateTree: TezosSaplingStateTree = await this.state.getStateTreeFromStateDiff(transaction.stateDiff)

    const boundData: string | undefined =
      transaction.unshieldTarget && transaction.unshieldTarget.length > 0
        ? this.createAddressBoundData(transaction.unshieldTarget)
        : undefined

    const forgedTransaction: TezosSaplingTransaction = await this.forger.forgeSaplingTransaction(
      transaction.ins,
      transaction.outs,
      stateTree,
      this.getAntiReplay(transaction.chainId, transaction.contractAddress),
      boundData,
      privateKey
    )

    return this.encoder.encodeTransaction(forgedTransaction).toString('hex')
  }

  public async getTransactionDetails(
    transaction: UnsignedTezosTransaction | UnsignedTezosSaplingTransaction,
    data?: { knownViewingKeys: string[] }
  ): Promise<IAirGapTransaction[]> {
    const tx = transaction.transaction

    const airGapTxs: IAirGapTransaction[] = []
    if (this.isRawTezosSaplingTransaction(tx)) {
      const unshieldTarget = tx.unshieldTarget.length > 0 ? tx.unshieldTarget : undefined
      const from: TezosSaplingAddress = await this.getAddressFromPublicKey(transaction.publicKey)
      const details: IAirGapTransaction[] = this.bookkeeper
        .getUnsignedTransactionDetails(from, tx.ins, tx.outs, unshieldTarget)
        .map((details: IAirGapTransaction) => ({
          ...details,
          extra: {
            ...details.extra,
            destination: tx.contractAddress,
            chainId: tx.chainId
          },
          transactionDetails: tx
        }))

      airGapTxs.push(...details)
    } else {
      const wrappedOperation: TezosWrappedOperation = await this.tezosProtocol.unforgeUnsignedTezosWrappedOperation(tx.binaryTransaction)
      airGapTxs.push(...(await this.getTransactionDetailsFromWrappedOperation(wrappedOperation, data?.knownViewingKeys)))
    }

    return this.filterOutPaybacks(airGapTxs)
  }

  public async getTransactionDetailsFromSigned(
    transaction: SignedTezosTransaction,
    data?: { knownViewingKeys: string[] }
  ): Promise<IAirGapTransaction[]> {
    const airGapTxs: IAirGapTransaction[] = []
    const tx = transaction.transaction

    const defaultDetails: IAirGapTransaction = {
      from: ['Shielded Pool'],
      to: ['Shielded Pool'],
      isInbound: false,
      amount: '0',
      fee: '0',
      protocolIdentifier: this.identifier,
      network: this.options.network
    }

    if (this.contract.areValidParameters(tx)) {
      const partialDetails: Partial<IAirGapTransaction>[] = await this.getPartialDetailsFromContractParameters(tx, data?.knownViewingKeys)

      airGapTxs.push(
        ...partialDetails.map((partial: Partial<IAirGapTransaction>) => ({
          ...defaultDetails,
          ...partial
        }))
      )
    } else {
      try {
        const wrappedOperation: TezosWrappedOperation = await this.tezosProtocol.unforgeSignedTezosWrappedOperation(tx)

        airGapTxs.push(...(await this.getTransactionDetailsFromWrappedOperation(wrappedOperation, data?.knownViewingKeys)))
      } catch {
        const partialDetails: Partial<IAirGapTransaction>[] = await this.bookkeeper.getTransactionsPartialDetails(
          [tx],
          data?.knownViewingKeys
        )

        airGapTxs.push(
          ...partialDetails.map((partial: Partial<IAirGapTransaction>) => ({
            ...defaultDetails,
            ...partial
          }))
        )
      }
    }

    return this.filterOutPaybacks(airGapTxs)
  }

  private async getTransactionDetailsFromWrappedOperation(
    operation: TezosWrappedOperation,
    knownViewingKeys: string[] = []
  ): Promise<IAirGapTransaction[]> {
    type TezosContractOperation = TezosTransactionOperation & Required<Pick<TezosTransactionOperation, 'parameters'>>
    const contractOperations: TezosContractOperation[] = operation.contents.filter(
      (content: TezosOperation) =>
        content.kind === TezosOperationType.TRANSACTION && (content as TezosTransactionOperation).parameters !== undefined
    ) as TezosContractOperation[]

    const details: IAirGapTransaction[][] = await Promise.all(
      contractOperations.map(async (operation: TezosContractOperation) => {
        const saplingDetails: Partial<IAirGapTransaction>[] = await this.getPartialDetailsFromContractParameters(
          operation.parameters,
          knownViewingKeys
        )

        return saplingDetails.map((partials: Partial<IAirGapTransaction>) => ({
          from: [operation.source],
          to: ['Shielded Pool'],
          isInbound: false,
          amount: operation.amount,
          fee: operation.fee,
          protocolIdentifier: this.identifier,
          network: this.options.network,
          ...partials,
          transactionDetails: operation
        }))
      })
    )

    return flattenArray(details)
  }

  private async getPartialDetailsFromContractParameters(
    rawOrParsed: string | TezosTransactionParameters,
    knownViewingKeys: string[] = []
  ): Promise<Partial<IAirGapTransaction>[]> {
    const parameters: TezosTransactionParameters =
      typeof rawOrParsed === 'string' ? this.contract.parseParameters(rawOrParsed) : rawOrParsed

    const txs: string[] = await this.parseParameters(parameters)

    return this.bookkeeper.getTransactionsPartialDetails(txs, knownViewingKeys)
  }

  private filterOutPaybacks(airGapTxs: IAirGapTransaction[]): IAirGapTransaction[] {
    const filtered: IAirGapTransaction[] = airGapTxs.filter((details: IAirGapTransaction) => {
      if (details.from.length !== details.to.length) {
        return true
      }

      const fromSet: Set<string> = new Set(details.from)
      const toSet: Set<string> = new Set(details.to)

      return Array.from(fromSet).some((address: string) => !toSet.has(address))
    })

    return filtered.length > 0 ? filtered : airGapTxs
  }

  public async getBalanceOfPublicKey(publicKey: string): Promise<string> {
    const saplingStateDiff: TezosSaplingStateDiff = await this.nodeClient.getSaplingStateDiff()
    const unspends: TezosSaplingInput[] = await this.bookkeeper.getUnspends(
      publicKey,
      saplingStateDiff.commitments_and_ciphertexts,
      saplingStateDiff.nullifiers
    )

    const balance: BigNumber = unspends.reduce((sum: BigNumber, next: TezosSaplingInput) => sum.plus(next.value), new BigNumber(0))

    return balance.toString()
  }

  public async getTransactionStatuses(transactionHash: string[]): Promise<AirGapTransactionStatus[]> {
    throw new Error('Method not implemented.')
  }

  public async estimateMaxTransactionValueFromPublicKey(
    publicKey: string,
    recipients: string[],
    fee?: string | undefined
  ): Promise<string> {
    return this.getBalanceOfPublicKey(publicKey)
  }

  public async prepareTransactionFromPublicKey(
    publicKey: string,
    recipients: string[],
    values: string[],
    fee: string,
    data?: any
  ): Promise<RawTezosSaplingTransaction> {
    if (recipients.length > 1 && values.length > 1) {
      return Promise.reject('Multiple sapling transactions are not supported')
    }

    if (recipients.length === 0 && values.length === 0) {
      return Promise.reject('No recpients and values have been provided')
    }

    const recipient = recipients[0]
    const value = values[0]

    if (TezosAddress.isTzAddress(recipient)) {
      return this.prepareUnshieldTransaction(publicKey, recipient, value, data)
    } else if (TezosSaplingAddress.isZetAddress(recipient)) {
      return this.prepareSaplingTransaction(publicKey, recipient, value, data)
    }

    return Promise.reject(`Invalid recpient, expected a 'tz' or 'zet' address, got ${recipient}`)
  }

  public async wrapSaplingTransactions(
    publicKey: string,
    transactionsOrString: string[] | string,
    fee: string,
    overrideFees: boolean = false
  ): Promise<RawTezosTransaction> {
    let operations: TezosOperation[]
    if (typeof transactionsOrString === 'string' && this.contract.areValidParameters(transactionsOrString)) {
      const parameters = this.contract.parseParameters(transactionsOrString)
      operations = [this.prepareTezosOperation(parameters, fee) as TezosOperation]
    } else {
      const transactions = Array.isArray(transactionsOrString) ? transactionsOrString : [transactionsOrString]
      const contractCalls: TezosContractCall[] = await this.prepareContractCalls(transactions)
      operations = contractCalls.map(
        (contractCall: TezosContractCall) =>
          this.prepareTezosOperation(contractCall.toJSON(), fee, contractCall.amount?.toString()) as TezosOperation
      )
    }

    try {
      const tezosWrappedOperation: TezosWrappedOperation = await this.tezosProtocol.prepareOperations(publicKey, operations, overrideFees)
      const binaryTx: string = await this.tezosProtocol.forgeTezosOperation(tezosWrappedOperation)

      return { binaryTransaction: binaryTx }
    } catch (error) {
      console.error(error)
      if (error.code !== undefined && error.code === ProtocolErrorType.TRANSACTION_FAILED) {
        const rpcErrors = error.data as { id: string; kind: string; amount?: string; balance?: string; contract?: string }[]
        const cannotPayStorageFee = rpcErrors.find((error) => error.id.endsWith('.contract.cannot_pay_storage_fee'))
        if (cannotPayStorageFee) {
          throw new BalanceError(Domain.TEZOS, 'Balance too low, cannot pay for storage fee')
        }
        const balanceTooLowError = rpcErrors.find((error) => error.id.endsWith('.contract.balance_too_low'))
        if (balanceTooLowError) {
          throw new BalanceError(Domain.TEZOS, 'Balance too low')
        }
      }
      throw error
    }
  }

  private prepareTezosOperation(
    parameters: TezosTransactionParameters,
    fee: string,
    amount: string = '0'
  ): Partial<TezosTransactionOperation> {
    return {
      kind: TezosOperationType.TRANSACTION,
      fee,
      amount,
      destination: this.options.config.contractAddress,
      parameters
    }
  }

  public async prepareShieldTransaction(
    publicKey: string,
    recipient: string,
    value: string,
    fee: string,
    data?: { overrideFees?: boolean }
  ): Promise<RawTezosTransaction> {
    const encodedTransaction: string = await this.mint(recipient, value)
    return this.wrapSaplingTransactions(publicKey, [encodedTransaction], fee, data?.overrideFees)
  }

  public async prepareUnshieldTransaction(
    viewingKey: string,
    recipient: string,
    value: string,
    data?: any
  ): Promise<RawTezosSaplingTransaction> {
    if (!TezosAddress.isTzAddress(recipient)) {
      return Promise.reject(`Invalid recpient, expected a 'tz' address, got ${recipient}`)
    }

    const burnTransaction: RawTezosSaplingTransaction = await this.burn(viewingKey, value)

    return {
      ...burnTransaction,
      unshieldTarget: recipient
    }
  }

  public async prepareSaplingTransaction(
    viewingKey: string,
    recipient: string,
    value: string,
    data?: any
  ): Promise<RawTezosSaplingTransaction> {
    if (!TezosSaplingAddress.isZetAddress(recipient)) {
      return Promise.reject(`Invalid recpient, expected a 'zet' address, got ${recipient}`)
    }

    const dummyInputsAmount: number = Math.max(new BigNumber(data?.dummyInputs ?? 0).toNumber(), 0)
    const dummyOutputsAmount: number = Math.max(new BigNumber(data?.dummyOutputs ?? 0).toNumber(), 0)

    const [stateDiff, chainId]: [TezosSaplingStateDiff, string] = await Promise.all([
      this.nodeClient.getSaplingStateDiff(),
      this.nodeClient.getChainId()
    ])

    const [inputs, toSpend]: [TezosSaplingInput[], BigNumber] = await this.chooseInputs(
      viewingKey,
      stateDiff.commitments_and_ciphertexts,
      stateDiff.nullifiers,
      value
    )

    const address: TezosSaplingAddress = await this.getAddressFromPublicKey(viewingKey)

    const paymentOutput: TezosSaplingOutput = this.createPaymentOutput(await TezosSaplingAddress.fromValue(recipient), value)
    const paybackOutput: TezosSaplingOutput | undefined = this.createPaybackOutput(address, toSpend, value)

    const [dummyInputs, dummyOutputs]: [TezosSaplingInput[], TezosSaplingOutput[]] = await Promise.all([
      Promise.all(Array.from({ length: dummyInputsAmount }, (_v, _k) => this.createDummyInput(address))),
      Promise.all(Array.from({ length: dummyOutputsAmount }, (_v, _k) => this.createDummyOutput()))
    ])

    return {
      ins: inputs.concat(dummyInputs),
      outs: [paymentOutput, paybackOutput, ...dummyOutputs].filter((output) => output !== undefined) as TezosSaplingOutput[],
      contractAddress: this.options.config.contractAddress,
      chainId,
      stateDiff,
      unshieldTarget: ''
    }
  }

  private async mint(recipient: string, value: string): Promise<string> {
    if (!TezosSaplingAddress.isZetAddress(recipient)) {
      return Promise.reject(`Invalid recipient, expected a 'zet' address, got ${recipient}`)
    }

    const [saplingStateDiff, chainId]: [TezosSaplingStateDiff, string] = await Promise.all([
      this.nodeClient.getSaplingStateDiff(),
      this.nodeClient.getChainId()
    ])

    const output: TezosSaplingOutput = {
      address: (await TezosSaplingAddress.fromValue(recipient)).getValue(),
      value,
      memo: Buffer.alloc(this.options.config.memoSize).toString('hex'),
      browsable: true
    }

    const stateTree: TezosSaplingStateTree = await this.state.getStateTreeFromStateDiff(saplingStateDiff, true)

    const forgedTransaction: TezosSaplingTransaction = await this.forger.forgeSaplingTransaction(
      [],
      [output],
      stateTree,
      this.getAntiReplay(chainId)
    )

    return this.encoder.encodeTransaction(forgedTransaction).toString('hex')
  }

  private async burn(viewingKey: string, value: string): Promise<RawTezosSaplingTransaction> {
    const [stateDiff, chainId]: [TezosSaplingStateDiff, string] = await Promise.all([
      this.nodeClient.getSaplingStateDiff(),
      this.nodeClient.getChainId()
    ])

    const [inputs, toSpend]: [TezosSaplingInput[], BigNumber] = await this.chooseInputs(
      viewingKey,
      stateDiff.commitments_and_ciphertexts,
      stateDiff.nullifiers,
      value
    )

    const paybackOutput: TezosSaplingOutput = {
      address: (await this.getAddressFromPublicKey(viewingKey)).getValue(),
      value: toSpend.minus(value).toString(),
      memo: Buffer.alloc(this.options.config.memoSize).toString('hex'),
      browsable: true
    }

    return {
      ins: inputs,
      outs: [paybackOutput],
      contractAddress: this.options.config.contractAddress,
      chainId,
      stateDiff,
      unshieldTarget: ''
    }
  }

  private async chooseInputs(
    viewingKey: Buffer | string,
    commitmentsWithCiphertext: [string, TezosSaplingCiphertext][],
    nullifiers: string[],
    value: string | number | BigNumber
  ): Promise<[TezosSaplingInput[], BigNumber]> {
    const unspends: TezosSaplingInput[] = await this.bookkeeper.getUnspends(viewingKey, commitmentsWithCiphertext, nullifiers)
    const balance: BigNumber = this.bookkeeper.sumNotes(unspends)

    if (balance.lt(value)) {
      return Promise.reject('Not enough balance')
    }

    const chosenUnspends: TezosSaplingInput[] = []
    let toSpend: BigNumber = new BigNumber(0)

    for (const unspend of unspends) {
      if (toSpend.gte(value)) {
        break
      }

      toSpend = toSpend.plus(unspend.value)
      chosenUnspends.push(unspend)
    }

    return [chosenUnspends, toSpend]
  }

  private createPaymentOutput(
    address: TezosSaplingAddress,
    value: BigNumber | number | string,
    memo: Buffer = Buffer.alloc(this.options.config.memoSize)
  ): TezosSaplingOutput {
    return {
      address: address.getValue(),
      value: new BigNumber(value).toString(),
      memo: memo.toString('hex'),
      browsable: true
    }
  }

  private createPaybackOutput(
    address: TezosSaplingAddress,
    toSpend: BigNumber,
    value: BigNumber | number | string,
    memo: Buffer = Buffer.alloc(this.options.config.memoSize)
  ): TezosSaplingOutput | undefined {
    const paybackValue: BigNumber = toSpend.minus(value)

    return paybackValue.gt(0)
      ? {
          address: address.getValue(),
          value: paybackValue.toString(),
          memo: memo.toString('hex'),
          browsable: true
        }
      : undefined
  }

  private async createDummyInput(address: TezosSaplingAddress): Promise<TezosSaplingInput> {
    const rcm: Buffer = await sapling.randR()

    return {
      rcm: rcm.toString('hex'),
      pos: '0',
      value: '0',
      address: address.getValue()
    }
  }

  private async createDummyOutput(): Promise<TezosSaplingOutput> {
    await sodium.ready

    const address: TezosSaplingAddress = await this.getDummyAddress()
    const memo: Uint8Array = sodium.randombytes_buf(this.options.config.memoSize)

    return {
      address: address.getValue(),
      value: '0',
      memo: Buffer.from(memo).toString('hex'),
      browsable: false
    }
  }

  private async getDummyAddress(): Promise<TezosSaplingAddress> {
    await sodium.ready

    const seed: Uint8Array = sodium.randombytes_buf(32)
    const viewingKey: string = await this.getPublicKeyFromHexSecret(Buffer.from(seed).toString('hex'), this.standardDerivationPath)

    return this.getAddressFromPublicKey(viewingKey)
  }

  private createAddressBoundData(address: string): string {
    const michelson: MichelsonAddress = MichelsonAddress.from(TezosUtils.encodeTzAddress(address))

    return TezosUtils.packMichelsonType(michelson)
  }

  private getAntiReplay(chainId: string, contractAddress?: string): string {
    return (contractAddress ?? this.options.config.contractAddress) + chainId
  }

  public async broadcastTransaction(rawTransaction: any): Promise<string> {
    return this.tezosProtocol.broadcastTransaction(rawTransaction)
  }

  public async signMessage(message: string, keypair: { publicKey?: string | undefined; privateKey: Buffer }): Promise<string> {
    return this.tezosProtocol.signMessage(message, keypair)
  }

  public async verifyMessage(message: string, signature: string, publicKey: string): Promise<boolean> {
    return this.tezosProtocol.verifyMessage(message, signature, publicKey)
  }

  public async encryptAsymmetric(payload: string, publicKey: string): Promise<string> {
    return this.encryptAsymmetric(payload, publicKey)
  }

  public async decryptAsymmetric(
    encryptedPayload: string,
    keypair: { publicKey?: string | undefined; privateKey: Buffer }
  ): Promise<string> {
    return this.decryptAsymmetric(encryptedPayload, keypair)
  }

  public async encryptAES(payload: string, privateKey: Buffer): Promise<string> {
    return this.encryptAES(payload, privateKey)
  }

  public async decryptAES(encryptedPayload: string, privateKey: Buffer): Promise<string> {
    return this.decryptAES(encryptedPayload, privateKey)
  }

  public async getBlockExplorerLinkForAddress(address: string): Promise<string> {
    throw new Error('Method `getBlockExplorerLinkForAddress` not supported.')
  }

  public async getTransactionsFromAddresses(
    addresses: string[],
    limit: number,
    cursor?: TezosSaplingTransactionCursor
  ): Promise<TezosSaplingTransactionResult> {
    throw new Error('Method `getTransactionsFromAddresses` not supported.')
  }

  public async getBalanceOfAddresses(addresses: string[]): Promise<string> {
    throw new Error('Method `getBalanceOfAddresses` not supported.')
  }

  public async getAvailableBalanceOfAddresses(addresses: string[]): Promise<string> {
    throw new Error('Method `getAvailableBalanceOfAddresses` not supported.')
  }

  public async getBalanceOfPublicKeyForSubProtocols(publicKey: string, subProtocols: ICoinSubProtocol[]): Promise<string[]> {
    throw new Error('Method `getBalanceOfPublicKeyForSubProtocols` not supported.')
  }

  public async estimateFeeDefaultsFromPublicKey(
    publicKey: string,
    recipients: string[],
    values: string[],
    data?: any
  ): Promise<FeeDefaults> {
    throw new Error('Method `estimateFeeDefaultsFromPublicKey` not supported.')
  }

  private isRawTezosSaplingTransaction(transaction: unknown): transaction is RawTezosSaplingTransaction {
    return (
      transaction instanceof Object &&
      'ins' in transaction &&
      'outs' in transaction &&
      'contractAddress' in transaction &&
      'chainId' in transaction &&
      'stateDiff' in transaction
    )
  }
}
