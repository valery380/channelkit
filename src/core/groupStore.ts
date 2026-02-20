import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export interface GroupMapping {
  groupId: string;
  serviceName: string;
  webhook: string;
  userId: string;
  createdAt: number;
}

export class GroupStore {
  private groups: Record<string, GroupMapping> = {};

  constructor(private filePath: string = './data/groups.json') {
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
}
