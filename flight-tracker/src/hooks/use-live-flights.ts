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
    let pending = new Map<string, LiveFlight | null>();
    let snapshot: LiveFlight[] | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const queueFlight = (flight: LiveFlight) => {
      const previous = pending.get(flight.id);
      pending.set(flight.id, previous ? { ...previous, ...flight } : flight);
    };
    const flush = () => {
      flushTimer = undefined;
      const updates = pending;
      const replacement = snapshot;
      pending = new Map();
      snapshot = null;
      setFlights((old) => {
        const next = replacement ? new Map(replacement.map((flight) => [flight.id, flight])) : new Map(old);
        updates.forEach((flight, id) => {
          if (flight === null) next.delete(id);
          else next.set(id, { ...next.get(id), ...flight });
        });
        return next;
      });
      setUpdatedAt(Date.now());
    };
    const scheduleFlush = () => {
      if (flushTimer === undefined) flushTimer = setTimeout(flush, 150);
    };
    const unsubscribe = socket.subscribe((event) => {
      if ('type' in event && event.type === 'snapshot') {
        snapshot = event.flights;
        pending.clear();
      } else if ('type' in event && event.type === 'batch') {
        event.flights.forEach(queueFlight);
      } else if ('type' in event && event.type === 'remove') pending.set(event.id, null);
      else queueFlight(event);
      scheduleFlush();
    });
    const unsubscribeStatus = socket.onStatus(setState);
    socket.connect();
    return () => {
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      unsubscribe();
      unsubscribeStatus();
      socket.disconnect();
    };
  }, []);
  const list = useMemo(() => [...flights.values()].sort((a,b) => (a.callsign ?? a.id).localeCompare(b.callsign ?? b.id)), [flights]);
  const stale = updatedAt !== null && now - updatedAt > 30_000;
  return { flights: list, state, stale, updatedAt, demo: config.mock, missingConfig: !config.mock && !config.wsUrl };
}
