import { createHmac } from 'node:crypto'

export interface ImSessionInfrastructure {
  userTokenSecret: string
  tokenGeneration(userId: string): Promise<string>
  bootstrap(userId: string, token: string): Promise<unknown>
}

export class ImSessionApplication {
  constructor(private readonly infrastructure: ImSessionInfrastructure) {}

  async bootstrap(userId: string): Promise<unknown> {
    const generation = await this.infrastructure.tokenGeneration(userId)
    const token = createHmac('sha256', this.infrastructure.userTokenSecret)
      .update(`wukong-user:${userId}:${generation}`)
      .digest('base64url')
    return this.infrastructure.bootstrap(userId, token)
  }
}
