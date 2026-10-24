import type { FlightPosition, HistoricalFlight } from './types';
import { config } from './config';

export interface HistoryParams { q?: string; aircraftType?: string; status?: string; from?: string; to?: string; page?: number; pageSize?: number }
export interface HistoryResponse { items: HistoricalFlight[]; total: number; page: number; pageSize: number }
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!config.apiBaseUrl) throw new Error('Flight API is not configured. Set VITE_FLIGHT_API_BASE_URL.');
  const response = await fetch(`${config.apiBaseUrl}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Flight API returned ${response.status}`);
  return response.json() as Promise<T>;
}
export function getHistory(params: HistoryParams, signal?: AbortSignal) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') query.set(k, String(v)); });
  return request<unknown>(`/flights/history?${query}`, signal).then((value) => {
    if (!value || typeof value !== 'object' || !Array.isArray((value as HistoryResponse).items)) throw new Error('Invalid history response: expected an items array.');
    const result = value as HistoryResponse;
    if (!Number.isFinite(result.total) || !Number.isFinite(result.page) || !Number.isFinite(result.pageSize)) throw new Error('Invalid history response pagination metadata.');
    return result;
  });
}
export function getFlight(id: string, signal?: AbortSignal) {
  return request<unknown>(`/flights/${encodeURIComponent(id)}`, signal).then((value) => {
    if (!value || typeof value !== 'object' || typeof (value as HistoricalFlight).id !== 'string') throw new Error('Invalid flight detail response.');
    return value as HistoricalFlight;
  });
}
export function getPositions(id: string, signal?: AbortSignal) {
  return request<unknown>(`/flights/${encodeURIComponent(id)}/positions`, signal).then((value) => {
    if (!Array.isArray(value)) throw new Error('Invalid positions response: expected an array.');
    return value.filter((point): point is FlightPosition => !!point && typeof point.timestamp === 'string' &&
      typeof point.latitude === 'number' && point.latitude >= -90 && point.latitude <= 90 &&
      typeof point.longitude === 'number' && point.longitude >= -180 && point.longitude <= 180);
  });
}
