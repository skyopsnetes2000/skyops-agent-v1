/**
 * SkyOps Agent V1 - Registration Workflow
 */

import { AgentIdentityManager } from './AgentIdentity.ts';
import { RegistrationClient } from '../transport/RegistrationClient.ts';
import { Logger } from '../observability/Logger.ts';

export class RegistrationWorkflow {
  private readonly identityManager: AgentIdentityManager;
  private readonly client: RegistrationClient;
  private readonly logger: Logger;

  constructor(identityManager: AgentIdentityManager, client: RegistrationClient, logger?: Logger) {
    this.identityManager = identityManager;
    this.client = client;
    this.logger = logger?.child('registration') || new Logger('registration');
  }

  public async register(capabilities: string[]): Promise<boolean> {
    const identity = this.identityManager.getIdentity();

    this.logger.info('Initiating agent registration with SkyOps Cloud', {
      agentId: identity.agentId,
      environmentId: identity.environmentId,
      organizationId: identity.organizationId,
    });

    this.identityManager.updateStatus('registering');

    try {
      const response = await this.client.register({
        agentId: identity.agentId,
        installationId: identity.installationId,
        organizationId: identity.organizationId,
        environmentId: identity.environmentId,
        agentVersion: identity.agentVersion,
        clusterName: identity.clusterName,
        capabilities,
        systemInfo: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        },
      });

      if (response.registered) {
        if (response.assignedAgentId && response.assignedAgentId !== identity.agentId) {
          this.identityManager.setAssignedAgentId(response.assignedAgentId);
        }
        this.identityManager.updateStatus('running');
        this.logger.info('Agent successfully registered with SkyOps Cloud');
        return true;
      } else {
        this.logger.warn('Registration was rejected by SkyOps Cloud', { message: response.message });
        return false;
      }
    } catch (err) {
      this.logger.warn(
        'Cloud registration failed, continuing in autonomous offline mode',
        undefined,
        err
      );
      // In offline mode, the agent still runs and spools evidence locally
      this.identityManager.updateStatus('running');
      return false;
    }
  }
}
