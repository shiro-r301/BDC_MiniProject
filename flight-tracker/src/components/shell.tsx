import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, Clock3, Plane, Radio, Satellite, Wifi, WifiOff } from 'lucide-react';
import type { ConnectionState } from '@/lib/types';

interface Props { children: ReactNode; state: ConnectionState; stale: boolean; demo: boolean; lastUpdated?: number | null }
export function Shell({ children, state, stale, demo, lastUpdated }: Props) {
  const [path] = useLocation();
  const [clock,setClock] = useState(new Date());
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()),1000); return () => clearInterval(timer); }, []);
  const good = !demo && state === 'connected' && !stale;
  const connectionLabel = demo ? 'SIMULATED FEED' : stale ? 'STALE DATA' : good?'LIVE FEED':state==='connecting'?'CONNECTING':state==='reconnecting'?'RECONNECTING':state==='error'?'FEED ERROR':'OFFLINE';
  return <div className={`app-shell ${path === '/' ? 'app-shell-map' : ''}`}>
    <aside className="rail">
      <Link href="/" className="brand-mark" aria-label="Airspace home"><span className="brand-icon"><Plane size={19}/></span><span className="brand-name">SKY<span>TRACE</span></span></Link>
      <div className="rail-label">AIRSPACE</div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <Link href="/" className={`nav-link ${path==='/'?'active':''}`} data-testid="link-live"><Activity size={17}/><span>Live traffic</span><span className="nav-live" /></Link>
        <Link href="/history" className={`nav-link ${path==='/history'?'active':''}`} data-testid="link-history"><Clock3 size={17}/><span>Flight history</span></Link>
      </nav>
      <div className="rail-bottom"><div className="radar-mark"><span/><span/><span/><Satellite size={17}/></div><div className="rail-caption">NETWORK<br/>MONITOR</div><div className="rail-version">FLIGHT DESK <b>01</b></div></div>
    </aside>
    <main className={`workspace ${path === '/' ? 'workspace-map' : ''}`}>
      <header className="topbar">
        {path === '/' && <Link href="/" className="map-brand" aria-label="Skytrace live airspace"><span className="brand-icon"><Plane size={16}/></span><span>SKYTRACE</span></Link>}
        <div className="breadcrumbs"><span>OPERATIONS</span><i>/</i><strong>{path === '/history' ? 'HISTORY' : 'LIVE AIRSPACE'}</strong></div>
        <div className="topbar-right">
          {path === '/' && <Link href="/history" className="map-history-link" data-testid="link-history"><Clock3 size={15}/><span>History</span></Link>}
          {demo && <span className="demo-chip">SIMULATION MODE</span>}
          <div className={`connection-chip ${good?'connected':''}`} data-testid="status-connection"><span className="connection-dot"/>{connectionLabel}</div>
          <span className="utc-clock">{clock.toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit'})} <small>UTC</small></span>
        </div>
      </header>
      {path !== '/' && (stale || (!demo && state === 'disconnected')) && <div className={`feed-notice ${stale?'stale':''}`} role="status">
        {stale ? 'Live data is stale — last update ' : 'No live feed configured. Connect a WebSocket endpoint to receive aircraft.'}
        {stale && lastUpdated ? new Date(lastUpdated).toLocaleTimeString('en-GB',{timeZone:'UTC'})+' UTC' : ''}
      </div>}
      {children}
    </main>
  </div>;
}
