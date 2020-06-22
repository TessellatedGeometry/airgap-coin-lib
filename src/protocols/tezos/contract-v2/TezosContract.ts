import axios, { AxiosResponse } from '../../../dependencies/src/axios-0.19.0/index'

import { TezosContractEntrypoint } from './TezosContractEntrypoint'
import { MichelineNode } from './micheline/MichelineNode'
import { TezosContractParameters } from './TezosContractParameters'

export class TezosContract {
  private static readonly defaultEntrypoint = 'default'

  public entrypoints?: Map<string, TezosContractEntrypoint>
  public entrypointsPromise?: Promise<void>

  constructor(
    public readonly address: string,
    public readonly nodeRPCURL: string,
    public readonly conseilAPIURL: string,
    public readonly conseilNetwork: string,
    public readonly conseilAPIKey: string
  ) {}

  // TODO: types
  public async createContractCall(entrypointName: string, ...args: unknown[]): Promise<TezosContractParameters> {
    await this.waitForEntrypoints()

    const entrypoint: TezosContractEntrypoint | undefined = this.entrypoints?.get(entrypointName)
    if (!entrypoint) {
      return this.createDefaultContractParameters(args)
    }

    return this.createContractParameters(entrypoint, args)
  }

  private createDefaultContractParameters(_args: unknown[]): TezosContractParameters {
    return {
      entrypoint: TezosContract.defaultEntrypoint,
      value: {}
    }
  }

  private createContractParameters(entrypoint: TezosContractEntrypoint, args: unknown[]): TezosContractParameters {
    return {
      entrypoint: entrypoint.name,
      value: entrypoint.type.createValue(...args).toMichelineJSON()
    }
  }

  private async waitForEntrypoints(): Promise<void> {
    if (this.entrypoints !== undefined) {
      return
    }

    if (this.entrypointsPromise !== undefined) {
      return this.entrypointsPromise
    }

    const response: Record<'entrypoints', Record<string, MichelineNode>> = await this.getFromNode('entrypoints')
    this.entrypoints = new Map(
      TezosContractEntrypoint.fromJSON(response.entrypoints).map((entrypoint: TezosContractEntrypoint) => [entrypoint.name, entrypoint])
    )
  }

  private async getFromNode<T>(endpoint: string): Promise<T> {
    const response: AxiosResponse<T> = await axios.get(
      `${this.nodeRPCURL}/chains/main/blocks/head/context/contracts/${this.address}/${endpoint}`
    )

    return response.data
  }
}