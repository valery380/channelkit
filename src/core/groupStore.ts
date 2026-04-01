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
  private onChangeCallback?: (groups: Record<string, GroupMapping>) => void;

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
    if (this.onChangeCallback) this.onChangeCallback({ ...this.groups });
  }

  /** Set a callback to be called whenever groups change (for remote sync). */
  onChange(callback: (groups: Record<string, GroupMapping>) => void): void {
    this.onChangeCallback = callback;
  }

  /** Replace all groups with data fetched from a remote source. */
  replaceAll(groups: Record<string, GroupMapping>): void {
    this.groups = groups;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.groups, null, 2));
    // Don't trigger onChange to avoid sync loops
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
