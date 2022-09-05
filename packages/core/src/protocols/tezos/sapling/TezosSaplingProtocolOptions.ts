// tslint:disable: max-classes-per-file
import { SaplingPartialOutputDescription, SaplingUnsignedSpendDescription } from '@airgap/sapling-wasm'
import { NetworkType } from '../../../utils/ProtocolNetwork'
import { ProtocolOptions } from '../../../utils/ProtocolOptions'
import { MainProtocolSymbols, ProtocolSymbols } from '../../../utils/ProtocolSymbols'
import { CurrencyUnit, FeeDefaults } from '../../ICoinProtocol'
import { TezosNetwork } from '../TezosProtocol'
import { TezblockBlockExplorer, TezosProtocolConfig, TezosProtocolNetwork, TezosProtocolNetworkExtras } from '../TezosProtocolOptions'
import { TezosSaplingTransaction } from '../types/sapling/TezosSaplingTransaction'

export interface TezosSaplingExternalMethodProvider {
  initParameters?: (spendParams: Buffer, outputParams: Buffer) => Promise<void>
  withProvingContext?: (action: (context: number) => Promise<TezosSaplingTransaction>) => Promise<TezosSaplingTransaction>
  prepareSpendDescription?: (
    context: number,
    spendingKey: Buffer,
    address: Buffer,
    rcm: string,
    ar: Buffer,
    value: string,
    root: string,
    merklePath: string
  ) => Promise<SaplingUnsignedSpendDescription>
  preparePartialOutputDescription?: (
    context: number,
    address: Buffer,
    rcm: Buffer,
    esk: Buffer,
    value: string
  ) => Promise<SaplingPartialOutputDescription>
  createBindingSignature?: (context: number, balance: string, sighash: Buffer) => Promise<Buffer>
}

export class TezosSaplingProtocolConfig extends TezosProtocolConfig {
  constructor(
    public readonly name: string,
    public readonly identifier: ProtocolSymbols,
    public readonly contractAddress: string,
    public readonly memoSize: number,
    public readonly merkleTreeHeight: number = 32,
    public readonly symbol?: string,
    public readonly marketSymbol?: string,
    public readonly feeDefaults?: FeeDefaults,
    public readonly decimals?: number,
    public readonly units?: CurrencyUnit[],
    public readonly externalProvider?: TezosSaplingExternalMethodProvider
  ) {
    super()
  }
}

export class TezosShieldedTezProtocolConfig extends TezosSaplingProtocolConfig {
  constructor(
    public readonly name: string = 'Shielded Tez',
    public readonly identifier: ProtocolSymbols = MainProtocolSymbols.XTZ_SHIELDED,
    public readonly contractAddress: string = 'KT1Wr1z3CwrZamPsazpVXefpEjXUBScUPuHZ',
    public readonly externalProvider?: TezosSaplingExternalMethodProvider,
    public readonly memoSize: number = 8,
    public readonly merkleTreeHeight: number = 32
  ) {
    super(
      name,
      identifier,
      contractAddress,
      memoSize,
      merkleTreeHeight,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      externalProvider
    )
  }
}

export class TezosSaplingProtocolOptions implements ProtocolOptions<TezosSaplingProtocolConfig> {
  constructor(
    // public network: TezosProtocolNetwork = new TezosProtocolNetwork(),
    public network: TezosProtocolNetwork = new TezosProtocolNetwork(
      'Ithacanet',
      NetworkType.TESTNET,
      'https://tezos-ithacanet-node.prod.gke.papers.tech',
      new TezblockBlockExplorer('https//ithacanet.tezblock.io'),
      new TezosProtocolNetworkExtras(
        TezosNetwork.ITHACANET,
        'https://tezos-ithacanet-conseil.prod.gke.papers.tech',
        TezosNetwork.ITHACANET,
        'airgap00391'
      )
    ),
    public config: TezosSaplingProtocolConfig = new TezosShieldedTezProtocolConfig()
  ) {}
}
