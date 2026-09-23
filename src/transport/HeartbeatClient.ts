/**
 * SkyOps Agent V1 - Heartbeat Client
 */

import { TransportClient } from './TransportClient.ts';
import { HeartbeatPayload, HeartbeatResponse } from '../types/transport.ts';
import { Metrics } from '../observability/Metrics.ts';
import { Logger } from '../observability/Logger.ts';

export class HeartbeatClient {
  private readonly transport: TransportClient;
  private readonly metrics: Metrics;
  private readonly logger: Logger;

  constructor(transport: TransportClient, logger?: Logger) {
    this.transport = transport;
    this.metrics = Metrics.getInstance();
    this.logger = logger?.child('heartbeat') || new Logger('heartbeat');
  }

  public async sendHeartbeat(payload: HeartbeatPayload): Promise<HeartbeatResponse> {
    try {
      const response = await this.transport.post<HeartbeatPayload, HeartbeatResponse>(
        '/api/v1/agents/heartbeat',
        payload
      );
      this.metrics.increment('heartbeat_success_total');
      return response;
    } catch (err) {
      this.metrics.increment('heartbeat_failure_total');
      this.logger.debug('Heartbeat transmission failed, will retry next interval', undefined, err);

      // Return synthetic response so agent loop remains unaffected
      return {
        acknowledged: false,
        serverTimestamp: new Date().toISOString(),
      };
    }
  }
}
