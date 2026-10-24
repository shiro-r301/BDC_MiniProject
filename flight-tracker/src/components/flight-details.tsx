import { type ReactNode } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronRight, CircleDot, Clock3, Compass, Gauge, Plane, Radio, X } from 'lucide-react';
import { display, type LiveFlight } from '@/lib/types';
interface Props { flight?: LiveFlight; onClose: () => void }
function airport(value: LiveFlight['origin']) { return value ? `${value.iata ?? value.icao ?? '—'}${value.name ? ` · ${value.name}` : ''}` : 'Unavailable'; }
function coordinates(latitude?: number, longitude?: number) {
  return latitude === undefined || longitude === undefined
    ? 'Unavailable'
    : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
export function FlightDetails({ flight, onClose }: Props) {
  if (!flight) return <aside className="details-panel empty-details"><div className="detail-top"><span>FLIGHT INSPECTOR</span><button onClick={onClose} aria-label="Close inspector"><X size={16}/></button></div><div className="empty-inspector"><div className="empty-plane"><Plane size={24}/></div><strong>Select an aircraft</strong><p>Choose any aircraft on the map or in the traffic list to inspect its current details.</p></div></aside>;
  return <aside className="details-panel" aria-label="Selected flight details">
    <div className="detail-top"><span>FLIGHT INSPECTOR <i>·</i> {flight.icao24?.toUpperCase() ?? 'AIRCRAFT'}</span><button onClick={onClose} aria-label="Close inspector"><X size={16}/></button></div>
    <div className="detail-heading"><div className="flight-glyph"><Plane size={20} style={{transform:`rotate(${flight.heading ?? 0}deg)`}}/></div><div><div className="detail-callsign">{display(flight.callsign)}</div><div className="detail-model">{display(flight.aircraftModel)} <span>·</span> {display(flight.registration)}</div></div></div>
    <div className="route-block"><div className="route-airport"><b>{flight.origin?.iata ?? flight.origin?.icao ?? '—'}</b><span>{flight.origin?.name ?? 'Origin unavailable'}</span></div><div className="route-connector"><i/><ChevronRight size={15}/><i/></div><div className="route-airport destination"><b>{flight.destination?.iata ?? flight.destination?.icao ?? '—'}</b><span>{flight.destination?.name ?? 'Destination unavailable'}</span></div></div>
    <div className="detail-status"><span className="status-pulse"/>{(flight.status ?? 'status unavailable').toUpperCase()}<span className="detail-operator">{display(flight.operator)}</span></div>
    <div className="detail-section-title">FLIGHT PARAMETERS <span>LIVE</span></div>
    <div className="parameter-grid">
      <Parameter icon={<Gauge size={15}/>} name="ALTITUDE" value={display(flight.altitude, ' ft')}/>
      <Parameter icon={<ActivityIcon/>} name="GROUND SPEED" value={display(flight.speed, ' kt')}/>
      <Parameter icon={<Compass size={15}/>} name="HEADING" value={display(flight.heading, '°')}/>
      <Parameter icon={flight.verticalRate !== undefined && flight.verticalRate < 0 ? <ArrowDown size={15}/> : <ArrowUp size={15}/>} name="VERT. RATE" value={display(flight.verticalRate, ' ft/min')}/>
      <Parameter icon={<Radio size={15}/>} name="SQUAWK" value={display(flight.squawk)}/>
      <Parameter icon={<CircleDot size={15}/>} name="ICAO24" value={display(flight.icao24?.toUpperCase())}/>
    </div>
    <div className="detail-section-title">POSITION FILTER <span>{flight.kalmanUpdated === undefined ? 'RAW' : flight.kalmanUpdated ? 'KALMAN' : 'LATE FIX'}</span></div>
    <div className="kalman-comparison">
      <div><span>Raw fix</span><b>{coordinates(flight.rawLatitude, flight.rawLongitude)}</b></div>
      <div><span>Map position</span><b>{coordinates(flight.latitude, flight.longitude)}</b></div>
      <div><span>Filter status</span><b>{flight.kalmanUpdated === undefined ? 'Unavailable' : flight.kalmanUpdated ? 'Updated' : 'Not updated'}</b></div>
    </div>
    <div className="detail-section-title">AIRCRAFT</div>
    <div className="metadata-list"><div><span>Operator</span><b>{display(flight.operator)}</b></div><div><span>Category</span><b>{display(flight.aircraftType?.replaceAll('-',' '))}</b></div><div><span>Flight number</span><b>{display(flight.flightNumber)}</b></div></div>
    <div className="position-foot"><Clock3 size={13}/><span>POSITION TIME</span><b>{flight.positionTimestamp ? new Date(flight.positionTimestamp).toLocaleTimeString('en-GB',{timeZone:'UTC'})+' UTC' : 'Unavailable'}</b></div>
  </aside>;
}
function Parameter({icon,name,value}:{icon:ReactNode;name:string;value:string}) { return <div className="parameter"><span className="parameter-icon">{icon}</span><span className="parameter-name">{name}</span><strong>{value}</strong></div>; }
function ActivityIcon() { return <Activity size={15}/>; }
