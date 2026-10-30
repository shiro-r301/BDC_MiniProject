import { config } from './config';
import { validFlight, type LiveFlight, type ConnectionState } from './types';

type Listener = (event: LiveFlight | { type: 'remove'; id: string } | { type: 'snapshot'; flights: LiveFlight[] } | { type: 'batch'; flights: LiveFlight[] }) => void;
type StatusListener = (state: ConnectionState) => void;
export class FlightSocket {
  private socket?: WebSocket;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private connection: ConnectionState = 'disconnected';
  constructor(private url = config.wsUrl) {}
  subscribe(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onStatus(listener: StatusListener) { this.statusListeners.add(listener); listener(this.connection); return () => this.statusListeners.delete(listener); }
  get state() { return this.connection; }
  private setState(state: ConnectionState) { this.connection = state; this.statusListeners.forEach((fn) => fn(state)); }
  connect() {
    if (!this.url || !this.stopped) return;
    this.stopped = false;
    this.open();
  }
  private open() {
    if (this.stopped || !this.url) return;
    this.setState(this.retry ? 'reconnecting' : 'connecting');
    try {
      this.socket = new WebSocket(this.url);
      this.socket.onopen = () => { this.retry = 0; this.setState('connected'); };
      this.socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(String(event.data));
          if (envelope.type === 'flight.remove' && typeof envelope.id === 'string') {
            this.listeners.forEach((listener) => listener({ type:'remove', id:envelope.id }));
            return;
          }
          const records = envelope.type === 'snapshot' ? envelope.flights : envelope.flight ? [envelope.flight] : envelope.flights;
          if (envelope.type === 'snapshot' && Array.isArray(records)) {
            const flights = records.map((record: any) => record?.flight ?? record).filter(validFlight);
            this.listeners.forEach((listener) => listener({ type:'snapshot', flights }));
            return;
          }
          if (Array.isArray(records)) {
            const flights = records.map((record) => record?.flight ?? record).filter(validFlight);
            if (flights.length) this.listeners.forEach((listener) => listener({ type: 'batch', flights }));
          }
        } catch { /* Invalid message is ignored; the stream remains available. */ }
      };
      this.socket.onerror = () => this.setState('error');
      this.socket.onclose = () => {
        if (this.stopped) return;
        this.setState('reconnecting');
        const delay = Math.min(30_000, 700 * 2 ** Math.min(this.retry++, 6)) * (0.8 + Math.random() * 0.4);
        this.timer = setTimeout(() => this.open(), delay);
      };
    } catch { this.setState('error'); }
  }
  disconnect() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = undefined;
    this.setState('disconnected');
  }
}
