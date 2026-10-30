import { Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveFlight } from '@/lib/types';
import { display } from '@/lib/types';
interface Props { flights: LiveFlight[]; selectedId?: string; onSelect: (id:string)=>void }
export function FlightList({flights,selectedId,onSelect}:Props) {
  const listRef=useRef<HTMLDivElement>(null);
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const [scrollTop,setScrollTop]=useState(0);
  const [viewportHeight,setViewportHeight]=useState(500);
  const items=useMemo(()=>flights.filter((f)=>`${f.callsign??''} ${f.flightNumber??''} ${f.registration??''} ${f.operator??''}`.toLowerCase().includes(query.toLowerCase())&&(filter==='all'||f.aircraftType===filter)),[flights,query,filter]);
  const rowHeight=58;
  const windowSize=Math.ceil(viewportHeight/rowHeight)+8;
  const start=Math.max(0,Math.min(Math.floor(scrollTop/rowHeight)-4,items.length-windowSize));
  const end=Math.min(items.length,start+windowSize);
  useEffect(()=>{
    const element=listRef.current;
    if(!element)return;
    const observer=new ResizeObserver(([entry])=>{if(entry)setViewportHeight(entry.contentRect.height);});
    observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{if(listRef.current)listRef.current.scrollTop=0;setScrollTop(0);},[query,filter]);
  return <section className="traffic-panel">
    <div className="panel-head"><div><span className="eyebrow">AIRSPACE SCAN</span><h2>Traffic <span>{flights.length.toString().padStart(2,'0')}</span></h2></div><div className="traffic-live"><span/>TRACKING</div></div>
    <div className="list-tools"><label className="search-box"><Search size={15}/><input aria-label="Search traffic" data-testid="input-flight-search" placeholder="Callsign, operator…" value={query} onChange={(e)=>setQuery(e.target.value)}/><kbd>/</kbd></label><label className="filter-select"><SlidersHorizontal size={14}/><select aria-label="Filter by aircraft category" value={filter} onChange={(e)=>setFilter(e.target.value)}><option value="all">All aircraft</option><option value="commercial">Commercial</option><option value="cargo">Cargo</option><option value="general-aviation">General aviation</option><option value="helicopter">Helicopter</option><option value="other">Other</option></select></label></div>
    <div className="flight-list-head"><span>CALLSIGN / ROUTE</span><span>ALTITUDE</span><span>SPD</span></div>
    <div ref={listRef} className="flight-list" role="list" aria-label="Live aircraft" onScroll={(event)=>setScrollTop(event.currentTarget.scrollTop)}>
      {items.length>0&&<div aria-hidden="true" style={{height:start*rowHeight}}/>}
      {items.slice(start,end).map((flight,index)=> <button key={flight.id} role="listitem" aria-setsize={items.length} aria-posinset={start+index+1} data-testid={`row-flight-${flight.id}`} onClick={()=>onSelect(flight.id)} className={`flight-row ${flight.id===selectedId?'selected':''}`}>
        <span className="aircraft-type">{(flight.aircraftType??'other').slice(0,2).toUpperCase()}</span><span className="flight-primary"><strong>{display(flight.callsign ?? flight.flightNumber ?? flight.icao24)}</strong><small>{flight.origin?.iata??'—'} <i>→</i> {flight.destination?.iata??'—'} <em>{flight.aircraftType?.replaceAll('-',' ')??'type unavailable'}</em></small></span><span className="flight-alt">{flight.altitude!==undefined?`${Math.round(flight.altitude/100)/10}k`:'—'}<small>ft</small></span><span className="flight-speed">{flight.speed??'—'}<small>kt</small></span>
      </button>)}
      {items.length>0&&<div aria-hidden="true" style={{height:(items.length-end)*rowHeight}}/>}
      {!items.length && <div className="list-empty"><div className="empty-sweep"/><strong>{flights.length?'No matching aircraft':'No aircraft received'}</strong><p>{flights.length?'Try another callsign or category.':'Live aircraft will appear here when the feed is connected.'}</p></div>}
    </div>
    <div className="list-footer"><span>SHOWING {items.length} OF {flights.length}</span><span>FEED-ORDERED · AUTO-UPDATED</span></div>
  </section>;
}
