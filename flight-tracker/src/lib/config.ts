export const config = {
  wsUrl: import.meta.env.VITE_FLIGHT_WS_URL as string | undefined,
  apiBaseUrl: (import.meta.env.VITE_FLIGHT_API_BASE_URL as string | undefined)?.replace(/\/$/, ''),
  mapStyleUrl: import.meta.env.VITE_MAP_STYLE_URL as string | undefined,
  mock: import.meta.env.VITE_ENABLE_MOCK_DATA === 'true',
};
