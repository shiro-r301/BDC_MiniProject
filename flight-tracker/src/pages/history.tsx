import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, CircleStop, Clock3, Pause, Play, Search, SkipBack, SkipForward } from 'lucide-react';
import { Shell } from '@/components/shell';
import FlightMap from '@/components/flight-map';
import { FlightDetails } from '@/components/flight-details';
import { getFlight, getHistory, getPositions } from '@/lib/api';
import { config } from '@/lib/config';
import { mockHistory, mockPositions } from '@/lib/mock';
import type { FlightPosition, HistoricalFlight, LiveFlight } from '@/lib/types';

const pageSize=8;
export default function HistoryPage() {
  const [query,setQuery]=useState('');
  const [aircraftType,setAircraftType]=useState('');
  const [status,setStatus]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [page,setPage]=useState(1);
  const [selectedId,setSelectedId]=useState<string>();
  const [playing,setPlaying]=useState(false);
  const [playbackIndex,setPlaybackIndex]=useState(0);
  const args=useMemo(()=>({q:query||undefined,aircraftType:aircraftType||undefined,status:status||undefined,from:from||undefined,to:to||undefined,page,pageSize}),[query,aircraftType,status,from,to,page]);
  const historyQuery=useQuery({
    queryKey:['flight-history',args,config.mock],
    queryFn:({signal})=>config.mock ? Promise.resolve({items:mockHistory.filter((f)=> `${f.callsign??''} ${f.flightNumber??''} ${f.operator??''}`.toLowerCase().includes(query.toLowerCase())&&(!aircraftType||f.aircraftType===aircraftType)&&(!status||f.status===status)).slice((page-1)*pageSize,page*pageSize),total:mockHistory.filter((f)=>`${f.callsign??''} ${f.flightNumber??''} ${f.operator??''}`.toLowerCase().includes(query.toLowerCase())&&(!aircraftType||f.aircraftType===aircraftType)&&(!status||f.status===status)).length,page,pageSize}) : getHistory(args,signal),
  });
  const selectedSummary=historyQuery.data?.items.find((f)=>f.id===selectedId);
  const detailQuery=useQuery({ queryKey:['flight-detail',selectedId], queryFn:({signal})=>config.mock?Promise.resolve(mockHistory.find((f)=>f.id===selectedId)!):getFlight(selectedId!,signal), enabled:!!selectedId&&!config.mock });
  const flight=(config.mock?selectedSummary:detailQuery.data ?? selectedSummary) as HistoricalFlight | undefined;
  const positionsQuery=useQuery<FlightPosition[]>({queryKey:['flight-positions',selectedId],queryFn:({signal})=>config.mock?Promise.resolve(mockPositions(flight!)):getPositions(selectedId!,signal),enabled:!!selectedId&&!!flight});
  const positions=positionsQuery.data ?? [];
  const mapped:LiveFlight[]=flight?[{...flight,id:flight.id,latitude:flight.latitude,longitude:flight.longitude}]:[];
  const selectedMapFlight=mapped[0];
  const maxPosition=Math.max(0,positions.length-1);
  const currentPosition=positions[Math.min(playbackIndex,maxPosition)];
  const playbackFlight=selectedMapFlight && currentPosition ? {...selectedMapFlight,...currentPosition,latitude:currentPosition.latitude,longitude:currentPosition.longitude,heading:currentPosition.heading}:selectedMapFlight;
  const total=historyQuery.data?.total??0;
  const resetPage=()=>setPage(1);
  const choose=(id:string)=>{setSelectedId(id);setPlaybackIndex(0);setPlaying(false);};
  const advance=useCallback((step:number)=>setPlaybackIndex((v)=>Math.min(maxPosition,Math.max(0,v+step))),[maxPosition]);
  useEffect(()=> {
    if(!playing) return;
    const timer=window.setInterval(()=>setPlaybackIndex((v)=>{
      if(v>=maxPosition){setPlaying(false);return maxPosition;}
      return v+1;
    }),900);
    return ()=>window.clearInterval(timer);
  },[playing,maxPosition]);
  return <Shell state={config.mock?'connected':'disconnected'} stale={false} demo={config.mock}>
    <div className="page-content history-page">
      <section className="page-intro history-intro"><div><div className="page-kicker"><span className="kicker-rule"/>FLIGHT OPERATIONS / 02</div><h1>Flight <em>history</em></h1><p>Search recorded journeys and replay position data on the map.</p></div><div className="history-range"><CalendarDays size={16}/><span>ARCHIVE SEARCH</span></div></section>
      {config.mock && <div className="history-demo-note"><span className="demo-chip">SIMULATION MODE</span> Journey records and tracks are illustrative sample data.</div>}
      <div className="history-layout">
        <section className="history-records">
          <div className="history-tools">
            <label className="history-search"><Search size={15}/><input placeholder="Search callsign, flight or operator" aria-label="Search historical flights" value={query} onChange={(e)=>{setQuery(e.target.value);resetPage();}}/><kbd>/</kbd></label>
            <label className="history-filter"><span>CATEGORY</span><select aria-label="Filter category" value={aircraftType} onChange={(e)=>{setAircraftType(e.target.value);resetPage();}}><option value="">All types</option><option value="commercial">Commercial</option><option value="cargo">Cargo</option><option value="general-aviation">General aviation</option><option value="helicopter">Helicopter</option><option value="other">Other</option></select></label>
            <label className="history-filter"><span>STATUS</span><select aria-label="Filter status" value={status} onChange={(e)=>{setStatus(e.target.value);resetPage();}}><option value="">All statuses</option><option value="airborne">Airborne</option><option value="landed">Landed</option><option value="scheduled">Scheduled</option></select></label>
            <label className="history-filter"><span>FROM</span><input aria-label="From date" type="date" value={from} onChange={(e)=>{setFrom(e.target.value);resetPage();}}/></label>
            <label className="history-filter"><span>TO</span><input aria-label="To date" type="date" value={to} onChange={(e)=>{setTo(e.target.value);resetPage();}}/></label>
          </div>
          <div className="records-label"><span>RECORDED JOURNEYS</span><span>{historyQuery.isFetching?'UPDATING':`${total} RECORD${total===1?'':'S'}`}</span></div>
          {historyQuery.isError && <div className="query-error" role="alert"><strong>Could not load flight history</strong><span>{(historyQuery.error as Error).message}</span><button onClick={()=>historyQuery.refetch()}>Try again</button></div>}
          {historyQuery.isLoading && <div className="history-skeleton">{[0,1,2,3,4].map((i)=><div className="skeleton history-skeleton-row" key={i}/>)}</div>}
          {!historyQuery.isLoading && !historyQuery.isError && historyQuery.data?.items.length===0 && <div className="history-empty"><Clock3 size={20}/><strong>No recorded flights found</strong><span>Adjust the search or date filters to see more records.</span></div>}
          <div className="record-list">{historyQuery.data?.items.map((record)=>{
            const origin=record.origin?.iata??record.origin?.icao??'—', destination=record.destination?.iata??record.destination?.icao??'—';
            const when=record.departureTime??record.firstSeen??record.positionTimestamp;
            return <button key={record.id} onClick={()=>choose(record.id)} className={`record-row ${selectedId===record.id?'selected':''}`} data-testid={`row-history-${record.id}`}>
              <span className="record-type">{(record.aircraftType??'other').slice(0,2).toUpperCase()}</span><span className="record-main"><strong>{record.callsign??record.flightNumber??'Flight identifier unavailable'}</strong><small>{origin} <i>→</i> {destination} <em>{record.operator??record.aircraftType?.replaceAll('-',' ')??'metadata unavailable'}</em></small></span><span className="record-date">{when?new Date(when).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'Date unavailable'}<small>{when?new Date(when).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})+' UTC':'—'}</small></span><ChevronRight size={15}/>
            </button>;
          })}</div>
          {!historyQuery.isLoading && <div className="pagination"><span>PAGE {page} / {Math.max(1,Math.ceil(total/pageSize))}</span><div><button aria-label="Previous page" disabled={page<=1} onClick={()=>setPage((v)=>Math.max(1,v-1))}><ChevronLeft size={16}/></button><button aria-label="Next page" disabled={page>=Math.ceil(total/pageSize)} onClick={()=>setPage((v)=>v+1)}><ChevronRight size={16}/></button></div></div>}
        </section>
        <section className="journey-column">
          <div className="journey-header"><div><span className="eyebrow">JOURNEY PLAYBACK</span><strong>{flight?.callsign??flight?.flightNumber??'Select a flight'}</strong></div><span className={`journey-state ${flight?'':'muted'}`}>{flight?'RECORDED TRACK':'AWAITING SELECTION'}</span></div>
          <div className="journey-map-wrap">
            <FlightMap flights={playbackFlight?[playbackFlight]:[]} selectedId={playbackFlight?.id} onSelect={()=>{}} positions={positions.length?positions:undefined} playbackIndex={playbackIndex}/>
            {!flight && <div className="map-empty-shade"><Clock3 size={20}/><span>Select a historical record<br/>to load its journey</span></div>}
          </div>
          <div className="playback-panel">
            <div className="playback-times"><span>{positions[playbackIndex]?.timestamp?new Date(positions[playbackIndex].timestamp).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' UTC':'POSITION UNAVAILABLE'}</span><span>{positions.length?`${playbackIndex+1} / ${positions.length}`:'—'}</span></div>
            <input className="playback-range" aria-label="Journey playback position" type="range" min="0" max={maxPosition} value={Math.min(playbackIndex,maxPosition)} disabled={!positions.length} onChange={(e)=>{setPlaying(false);setPlaybackIndex(Number(e.target.value));}}/>
            <div className="playback-actions"><button aria-label="Beginning" disabled={!positions.length} onClick={()=>{setPlaying(false);setPlaybackIndex(0);}}><SkipBack size={16}/></button><button className="play-button" aria-label={playing?'Pause playback':'Start playback'} disabled={!positions.length} onClick={()=>setPlaying((v)=>!v)}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><button aria-label="Stop playback" disabled={!positions.length} onClick={()=>{setPlaying(false);setPlaybackIndex(0);}}><CircleStop size={16}/></button><button aria-label="Next position" disabled={!positions.length} onClick={()=>advance(1)}><SkipForward size={16}/></button><div className="playback-speed">1× <span>PLAYBACK</span></div></div>
          </div>
          {flight && <div className="journey-meta"><div><span>ORIGIN</span><b>{flight.origin?.iata??flight.origin?.icao??'Unavailable'}</b></div><i>→</i><div><span>DESTINATION</span><b>{flight.destination?.iata??flight.destination?.icao??'Unavailable'}</b></div><div className="journey-duration"><span>POSITIONS</span><b>{positions.length||'Unavailable'}</b></div></div>}
          {flight && <FlightDetails flight={playbackFlight} onClose={()=>setSelectedId(undefined)}/>}
          {positionsQuery.isError && <div className="query-error compact"><span>Journey positions could not be loaded.</span><button onClick={()=>positionsQuery.refetch()}>Retry</button></div>}
        </section>
      </div>
    </div>
  </Shell>;
}
