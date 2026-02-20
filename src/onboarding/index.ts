import { OnboardingConfig } from '../config/types';

export class Onboarding {
  constructor(private config: OnboardingConfig) {}

  async start(): Promise<void> {
    console.log(`⏳ Onboarding (${this.config.method}) is a placeholder — not yet implemented`);
  }

  async stop(): Promise<void> {}
}
