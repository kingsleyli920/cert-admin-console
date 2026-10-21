import type { MeResponse } from '@cac/shared';

export const alice = { id: 'alice', name: 'Alice Nguyen' };
export const bob = { id: 'bob', name: 'Bob Fraser' };

export const HHT = { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' };
export const SRA = { id: 2, code: 'SRA', name: 'Swan River Academy', timezone: 'Australia/Perth' };
export const LCL = { id: 3, code: 'LCL', name: 'Large Corp Learning', timezone: 'Australia/Sydney' };
export const NHI = { id: 4, code: 'NHI', name: 'Northern Health Institute', timezone: 'Australia/Brisbane' };

export const aliceMe: MeResponse = { admin: alice, tenants: [HHT, SRA, NHI] };
export const bobMe: MeResponse = { admin: bob, tenants: [LCL] };
