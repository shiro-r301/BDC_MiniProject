import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, List, Radio, RotateCw, X } from 'lucide-react';
import { Shell } from '@/components/shell';
import FlightMap from '@/components/flight-map';
import { FlightDetails } from '@/components/flight-details';
import { FlightList } from '@/components/flight-list';
import { useLiveFlights } from '@/hooks/use-live-flights';
import { isPosition } from '@/lib/types';
import './live-map.css';

export default function LivePage() {
  const {flights,state,stale,updatedAt,demo,missingConfig}=useLiveFlights();
  const [selectedId,setSelectedId]=useState<string>();
  const [trafficOpen,setTrafficOpen]=useState(()=>typeof window!=='undefined'&&window.innerWidth>820);
  const selected=useMemo(()=>flights.find((f)=>f.id===selectedId),[flights,selectedId]);
  const select=useCallback((id:string)=>setSelectedId(id),[]);
  const positioned=flights.filter(isPosition).length;
  const kalmanCount=flights.filter((flight)=>flight.kalmanUpdated===true).length;
  return <Shell state={state} stale={stale} demo={demo} lastUpdated={updatedAt}>
    <div className={`page-content live-page ${trafficOpen?'traffic-expanded':'traffic-collapsed'}`}>
      <section className="page-intro"><div><div className="page-kicker"><span className="kicker-rule"/>FLIGHT OPERATIONS / 01</div><h1>Live <em>airspace</em></h1><p>{kalmanCount>0?`${kalmanCount} aircraft currently use Kalman-filtered positions. Select a flight to compare its raw fix with the map position.`:'No Kalman-filtered positions received yet. Existing raw positions remain visible until the filtered stream arrives.'}</p></div><div className="intro-readout"><div><span>TRACKED</span><strong>{flights.length.toString().padStart(2,'0')}</strong></div><i/><div><span>WITH POSITION</span><strong>{positioned.toString().padStart(2,'0')}</strong></div></div></section>
      {missingConfig && <section className="setup-callout" role="status"><AlertTriangle size={17}/><div><strong>Live source not connected</strong><span>Set <code>VITE_FLIGHT_WS_URL</code> to your WebSocket endpoint. No sample flights are shown unless demo mode is explicitly enabled.</span></div></section>}
      {state==='error' && <section className="setup-callout error-callout" role="status"><Radio size={17}/><div><strong>Connection interrupted</strong><span>The client will retry automatically using an increasing backoff.</span></div><RotateCw size={16}/></section>}
      {stale && <section className="setup-callout stale-callout" role="status"><Radio size={17}/><div><strong>Showing the last received positions</strong><span>Live updates are delayed. Aircraft positions may no longer be current.</span></div></section>}
      <div className="live-grid">
        <div className="map-column"><FlightMap flights={flights} selectedId={selectedId} onSelect={select}/><div className="map-footnote"><span>MAP DATA © OPENSTREETMAP CONTRIBUTORS</span><span>KALMAN FILTERED: {kalmanCount}</span></div></div>
        {trafficOpen && <div className="traffic-column" id="traffic-overlay"><FlightList flights={flights} selectedId={selectedId} onSelect={select}/></div>}
      </div>
      <button className="traffic-toggle" type="button" onClick={()=>setTrafficOpen((open)=>!open)} aria-expanded={trafficOpen} aria-controls="traffic-overlay" aria-label={`${trafficOpen?'Hide':'Show'} live traffic list`}>
        {trafficOpen ? <X size={15}/> : <List size={15}/>}<span>{trafficOpen?'Hide traffic':'Traffic'}</span><b>{flights.length.toString().padStart(2,'0')}</b>
      </button>
      <FlightDetails flight={selected} onClose={()=>setSelectedId(undefined)}/>
      {demo && <div className="simulation-banner"><span className="demo-chip">SIMULATED</span> Sample aircraft and motion are illustrative only. This is not live aviation data.</div>}
    </div>
  </Shell>;
}
