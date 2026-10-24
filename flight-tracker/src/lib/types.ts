export type AircraftType = 'commercial' | 'cargo' | 'general-aviation' | 'helicopter' | 'other';
export type FlightStatus = 'airborne' | 'landed' | 'scheduled' | 'unknown' | string;
export interface LiveFlight {
  id: string; icao24?: string; callsign?: string; flightNumber?: string; registration?: string;
  aircraftType?: AircraftType; aircraftModel?: string; operator?: string; latitude?: number; longitude?: number;
  altitude?: number; speed?: number; heading?: number; verticalRate?: number; squawk?: string; origin?: Airport | null;
  destination?: Airport | null; status?: FlightStatus; positionTimestamp?: string; updatedAt?: string;
}
export interface Airport { icao?: string; iata?: string; name?: string; latitude?: number; longitude?: number }
export interface HistoricalFlight extends Partial<LiveFlight> {
  id: string; departureTime?: string; arrivalTime?: string; firstSeen?: string; lastSeen?: string;
}
export interface FlightPosition { timestamp: string; latitude: number; longitude: number; altitude?: number; speed?: number; heading?: number; verticalRate?: number }
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
export const unavailable = 'Unavailable';
export function display(value: unknown, suffix = ''): string {
  return value === undefined || value === null || value === '' ? unavailable : `${value}${suffix}`;
}
export function validFlight(value: unknown): value is LiveFlight {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' &&
    (v.latitude === undefined || (typeof v.latitude === 'number' && v.latitude >= -90 && v.latitude <= 90)) &&
    (v.longitude === undefined || (typeof v.longitude === 'number' && v.longitude >= -180 && v.longitude <= 180));
}
export function isPosition(f: LiveFlight): f is LiveFlight & { latitude: number; longitude: number } {
  return Number.isFinite(f.latitude) && Number.isFinite(f.longitude);
}
