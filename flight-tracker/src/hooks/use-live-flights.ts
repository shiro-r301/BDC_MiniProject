import { useEffect, useMemo, useState } from 'react';
import { FlightSocket } from '@/lib/live-socket';
import { config } from '@/lib/config';
import { mockFlights } from '@/lib/mock';
import type { ConnectionState, LiveFlight } from '@/lib/types';

export function useLiveFlights() {
  const [flights, setFlights] = useState<Map<string, LiveFlight>>(() => new Map());
  const [state, setState] = useState<ConnectionState>(config.mock ? 'connected' : config.wsUrl ? 'connecting' : 'disconnected');
  const [updatedAt, setUpdatedAt] = useState<number | null>(config.mock ? Date.now() : null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer=window.setInterval(()=>setNow(Date.now()),2500); return ()=>clearInterval(timer); }, []);
  useEffect(() => {
    if (config.mock) {
      setFlights(new Map(mockFlights.map((f) => [f.id, f])));
      const timer = window.setInterval(() => {
        setFlights((prev) => {
          const next = new Map(prev);
          for (const [id, f] of next) if (f.latitude !== undefined && f.longitude !== undefined) {
            next.set(id, { ...f, longitude: f.longitude + ((f.heading ?? 90) > 180 ? -0.004 : 0.004), latitude: f.latitude + Math.sin(Date.now()/6000 + f.longitude)*0.0007, positionTimestamp:new Date().toISOString() });
          }
          return next;
        });
        setUpdatedAt(Date.now());
      }, 2500);
      return () => clearInterval(timer);
    }
    if (!config.wsUrl) return;
    const socket = new FlightSocket();
    const unsubscribe = socket.subscribe((event) => {
      setFlights((old) => {
        const next = new Map(old);
        if ('type' in event && event.type === 'remove') next.delete(event.id);
        else if ('type' in event && event.type === 'snapshot') {
          next.clear();
          event.flights.forEach((flight)=>next.set(flight.id,flight));
        }
        else next.set(event.id, { ...old.get(event.id), ...event });
        return next;
      });
      setUpdatedAt(Date.now());
    });
    const unsubscribeStatus = socket.onStatus(setState);
    socket.connect();
    return () => { unsubscribe(); unsubscribeStatus(); socket.disconnect(); };
  }, []);
  const list = useMemo(() => [...flights.values()].sort((a,b) => (a.callsign ?? a.id).localeCompare(b.callsign ?? b.id)), [flights]);
  const stale = updatedAt !== null && now - updatedAt > 30_000;
  return { flights: list, state, stale, updatedAt, demo: config.mock, missingConfig: !config.mock && !config.wsUrl };
}
