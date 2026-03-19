import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export interface GroupMapping {
  groupId: string;
  serviceName: string;
  webhook: string;
  userId: string;
  createdAt: number;
}

/** Default groups.json path: ~/.channelkit/data/groups.json (absolute, CWD-independent) */
const DEFAULT_GROUPS_PATH = join(homedir(), '.channelkit', 'data', 'groups.json');

export class GroupStore {
  private groups: Record<string, GroupMapping> = {};

  constructor(private filePath: string = DEFAULT_GROUPS_PATH) {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        this.groups = JSON.parse(raw);
      }
    } catch {
      this.groups = {};
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.groups, null, 2));
  }

  add(groupId: string, mapping: GroupMapping): void {
    this.groups[groupId] = mapping;
    this.save();
  }

  get(groupId: string): GroupMapping | undefined {
    return this.groups[groupId];
  }

  getAll(): Record<string, GroupMapping> {
    return { ...this.groups };
  }

  findByUserAndService(userId: string, serviceName: string): GroupMapping | undefined {
    return Object.values(this.groups).find(
      g => g.userId === userId && g.serviceName === serviceName
    );
  }
}
