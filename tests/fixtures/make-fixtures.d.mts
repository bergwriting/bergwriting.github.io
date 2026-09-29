export const ROSTER_CSV: string;
export const FORBIDDEN: Record<string, string[]>;
export const REQUIRED: Record<string, string[]>;
export function allFixtures(): Promise<Record<string, Uint8Array>>;
export function okaforDocx(): Promise<Uint8Array>;
export function martinezDocx(): Promise<Uint8Array>;
export function youngPdf(): Promise<Uint8Array>;
export function scannedPdf(): Promise<Uint8Array>;
export function adeyemiDocx(): Promise<Uint8Array>;
