import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';
import { config } from '@/lib/config';
import { isPosition, type FlightPosition, type LiveFlight } from '@/lib/types';
import { Crosshair, Minus, Plus, RotateCcw } from 'lucide-react';

const defaultStyle = {
  version: 8 as const, sources: { osm: { type:'raster' as const, tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize:256, attribution:'© OpenStreetMap contributors' } },
  layers:[{ id:'osm', type:'raster' as const, source:'osm', minzoom:0, maxzoom:19 }],
};
interface Props { flights: LiveFlight[]; selectedId?: string; onSelect: (id: string) => void; positions?: FlightPosition[]; playbackIndex?: number }
type AircraftFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { id: string; selected: boolean; heading: number };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }>;
};
type JourneyFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
};
type MapView = { longitude: number; latitude: number; zoom: number };

function project(longitude: number, latitude: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180);
  return [
    ((longitude + 180) / 360) * scale,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  ];
}

function unproject(x: number, y: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / scale)) * 180) / Math.PI;
  return [longitude, latitude];
}

function RasterFallback({
  flights,
  selectedId,
  onSelect,
  positions,
  playbackIndex,
  view,
  onViewChange,
}: Props & { view: MapView; onViewChange: (view: MapView) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const zoom = Math.max(2, Math.min(18, view.zoom));
  const [centerX, centerY] = project(view.longitude, view.latitude, zoom);
  const left = centerX - size.width / 2;
  const top = centerY - size.height / 2;
  const worldSize = 256 * 2 ** zoom;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const firstTileX = Math.floor(left / 256);
  const lastTileX = Math.floor((left + size.width) / 256);
  const firstTileY = Math.floor(top / 256);
  const lastTileY = Math.floor((top + size.height) / 256);
  const tiles = [];
  for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      if (tileY < 0 || tileY >= 2 ** zoom) continue;
      const wrappedX = ((tileX % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
      tiles.push({
        key: `${zoom}-${tileX}-${tileY}`,
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        left: tileX * 256 - left,
        top: tileY * 256 - top,
      });
    }
  }

  const toScreen = (longitude: number, latitude: number): [number, number] => {
    let [x, y] = project(longitude, latitude, zoom);
    let dx = x - centerX;
    if (dx > worldSize / 2) dx -= worldSize;
    if (dx < -worldSize / 2) dx += worldSize;
    x = size.width / 2 + dx;
    y = y - top;
    return [x, y];
  };
  const journeyPositions = positions?.slice(
    0,
    playbackIndex === undefined ? positions.length : playbackIndex + 1,
  );
  const selected = flights.find((flight) => flight.id === selectedId);
  const route = journeyPositions?.length
    ? journeyPositions.map((point) => toScreen(point.longitude, point.latitude))
    : selected?.origin?.latitude !== undefined &&
        selected.origin.longitude !== undefined &&
        selected.destination?.latitude !== undefined &&
        selected.destination.longitude !== undefined
      ? [
          toScreen(selected.origin.longitude, selected.origin.latitude),
          toScreen(selected.destination.longitude, selected.destination.latitude),
        ]
      : [];
  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, centerX, centerY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const [longitude, latitude] = unproject(
      drag.current.centerX - (event.clientX - drag.current.x),
      drag.current.centerY - (event.clientY - drag.current.y),
      zoom,
    );
    onViewChange({ ...view, longitude, latitude });
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      ref={viewport}
      className="raster-map-fallback"
      role="region"
      aria-label="Aircraft map using OpenStreetMap raster tiles"
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="raster-tile-plane" aria-hidden="true">
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      {route.length > 1 && (
        <svg className="raster-route-overlay" aria-hidden="true">
          <polyline points={route.map(([x, y]) => `${x},${y}`).join(' ')} />
        </svg>
      )}
      {flights.filter(isPosition).map((flight) => {
        const [x, y] = toScreen(flight.longitude, flight.latitude);
        if (x < -32 || x > size.width + 32 || y < -32 || y > size.height + 32) return null;
        return (
          <button
            key={flight.id}
            type="button"
            className={`raster-aircraft-marker${selectedId === flight.id ? ' selected' : ''}`}
            style={{ left: x, top: y }}
            aria-label={`Select aircraft ${flight.callsign ?? flight.id}`}
            aria-pressed={selectedId === flight.id}
            title={flight.callsign ?? flight.id}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(flight.id);
            }}
          >
            <svg
              viewBox="0 0 32 32"
              aria-hidden="true"
              style={{ transform: `rotate(${flight.heading ?? 0}deg)` }}
            >
              <path d="M16 2.8 20.2 13l8.4 4.5v2.7L18.3 17l.7 8.2 3 1.8v2l-6-1.5-6 1.5v-2l3-1.8.7-8.2L3.4 20.2v-2.7l8.4-4.5L16 2.8Z" />
            </svg>
          </button>
        );
      })}
      {selected?.origin?.latitude !== undefined &&
        selected.origin.longitude !== undefined &&
        [selected.origin, selected.destination].map((airport) => {
          if (airport?.latitude === undefined || airport.longitude === undefined) return null;
          const [x, y] = toScreen(airport.longitude, airport.latitude);
          return (
            <span
              className="raster-airport-marker"
              key={`${selected.id}-${airport.icao ?? airport.iata ?? airport.name}`}
              style={{ left: x, top: y }}
            >
              {airport.iata ?? airport.icao ?? 'APT'}
            </span>
          );
        })}
    </div>
  );
}

export default function FlightMap({ flights, selectedId, onSelect, positions, playbackIndex }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const airportMarkers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [fallbackView, setFallbackView] = useState<MapView>({ longitude: 8, latitude: 49, zoom: 4 });
  const selected = flights.find((flight) => flight.id === selectedId);
  useEffect(() => {
    if (!host.current || map.current) return;
    let instance: MlMap;
    try {
      instance = new maplibregl.Map({ container: host.current, style: config.mapStyleUrl || defaultStyle, center:[8, 49], zoom:4.4, minZoom:2, maxZoom:17 });
    } catch {
      setMapFailed(true);
      return;
    }
    instance.addControl(new maplibregl.NavigationControl({ showCompass:true }), 'top-right');
    instance.on('load', () => {
      if (!instance.hasImage('aircraft-icon')) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        if (context) {
          context.scale(2, 2);
          context.fillStyle = '#fff';
          context.strokeStyle = '#fff';
          context.lineWidth = 0.7;
          context.lineJoin = 'round';
          const aircraft = new Path2D('M16 2.8 20.2 13l8.4 4.5v2.7L18.3 17l.7 8.2 3 1.8v2l-6-1.5-6 1.5v-2l3-1.8.7-8.2L3.4 20.2v-2.7l8.4-4.5L16 2.8Z');
          context.fill(aircraft);
          context.stroke(aircraft);
          instance.addImage('aircraft-icon', context.getImageData(0, 0, canvas.width, canvas.height), { sdf: true, pixelRatio: 2 });
        }
      }
      setReady(true);
    });
    map.current = instance;
    return () => {
      airportMarkers.current.forEach((m) => m.remove());
      airportMarkers.current = [];
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    airportMarkers.current.forEach((marker)=>marker.remove());
    airportMarkers.current=[];
    if(!map.current||!ready||!selected) return;
    [selected.origin,selected.destination].forEach((airport)=>{
      if(!airport||!Number.isFinite(airport.latitude)||!Number.isFinite(airport.longitude)) return;
      const element=document.createElement('div');
      element.className='airport-map-marker';
      const dot=document.createElement('span');
      const label=document.createElement('b');
      label.textContent=airport.iata??airport.icao??'APT';
      element.append(dot,label);
      element.setAttribute('aria-label',`${airport.name??'Airport'} ${airport.iata??airport.icao??''}`);
      airportMarkers.current.push(new maplibregl.Marker({element,anchor:'center'}).setLngLat([airport.longitude!,airport.latitude!]).addTo(map.current!));
    });
    return ()=>{airportMarkers.current.forEach((marker)=>marker.remove());airportMarkers.current=[];};
  },[ready,selectedId,selected?.origin?.latitude,selected?.origin?.longitude,selected?.origin?.iata,selected?.origin?.icao,selected?.origin?.name,selected?.destination?.latitude,selected?.destination?.longitude,selected?.destination?.iata,selected?.destination?.icao,selected?.destination?.name]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const sourceId = 'aircraft-clusters';
    const data: AircraftFeatureCollection = {
      type:'FeatureCollection',
      features:flights.filter(isPosition).map((f)=>({type:'Feature',properties:{id:f.id,selected:f.id===selectedId,heading:f.heading??0},geometry:{type:'Point',coordinates:[f.longitude,f.latitude]}})),
    };
    if (!instance.getSource(sourceId)) {
      instance.addSource(sourceId,{type:'geojson',data,cluster:true,clusterMaxZoom:5,clusterRadius:44});
      instance.addLayer({id:'aircraft-cluster-circles',type:'circle',source:sourceId,filter:['has','point_count'],paint:{'circle-color':'#d7ad52','circle-radius':['step',['get','point_count'],14,10,18,30,23],'circle-stroke-color':'#fbfaf1','circle-stroke-width':2,'circle-opacity':0.94}});
      instance.addLayer({id:'aircraft-cluster-count',type:'symbol',source:sourceId,filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Open Sans Bold','Arial Unicode MS Bold'],'text-size':11},paint:{'text-color':'#233e44'}});
      instance.addLayer({id:'aircraft-points',type:'symbol',source:sourceId,filter:['!', ['has','point_count']],layout:{'icon-image':'aircraft-icon','icon-size':['interpolate',['linear'],['zoom'],2,0.42,6,0.7,12,1.05],'icon-rotate':['get','heading'],'icon-rotation-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true},paint:{'icon-color':['case',['get','selected'],'#d2a137','#1d5360'],'icon-halo-color':'#f8faf7','icon-halo-width':1.1,'icon-opacity':0.95}});
      instance.on('click','aircraft-cluster-circles',(event)=>{
        const feature=event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (typeof clusterId !== 'number' || feature?.geometry.type !== 'Point') return;
        instance.easeTo({center:feature.geometry.coordinates as [number,number],zoom:Math.min(instance.getZoom()+2,8)});
      });
      instance.on('click','aircraft-points',(event)=>{
        const id=event.features?.[0]?.properties?.id;
        if(typeof id==='string') onSelect(id);
      });
      instance.on('mouseenter','aircraft-cluster-circles',()=>{instance.getCanvas().style.cursor='pointer';});
      instance.on('mouseleave','aircraft-cluster-circles',()=>{instance.getCanvas().style.cursor='';});
      instance.on('mouseenter','aircraft-points',()=>{instance.getCanvas().style.cursor='pointer';});
      instance.on('mouseleave','aircraft-points',()=>{instance.getCanvas().style.cursor='';});
    } else (instance.getSource(sourceId) as import('maplibre-gl').GeoJSONSource).setData(data);
  },[flights,ready,selectedId,onSelect]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const sourceId = 'journey-track';
    const data = positions?.length ? positions.slice(0, playbackIndex === undefined ? positions.length : playbackIndex + 1) : [];
    const coordinates: [number, number][] = data.length
      ? data.map((p): [number, number] => [p.longitude, p.latitude])
      : selected?.origin?.latitude !== undefined &&
          selected.origin.longitude !== undefined &&
          selected.destination?.latitude !== undefined &&
          selected.destination.longitude !== undefined
        ? [
            [selected.origin.longitude, selected.origin.latitude],
            [selected.destination.longitude, selected.destination.latitude],
          ]
        : [];
    const feature: JourneyFeature = { type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates } };
    const apply = () => {
      if (!instance.getSource(sourceId)) {
        instance.addSource(sourceId, { type:'geojson', data:feature });
        instance.addLayer({ id:'journey-track-line', type:'line', source:sourceId, paint:{ 'line-color':'#cf9b2e', 'line-width':3, 'line-opacity':0.86, 'line-dasharray':[2,1] } });
      } else (instance.getSource(sourceId) as import('maplibre-gl').GeoJSONSource).setData(feature);
    };
    if (instance.isStyleLoaded()) apply(); else instance.once('load', apply);
  }, [positions, playbackIndex, ready, selected?.origin?.latitude, selected?.origin?.longitude, selected?.destination?.latitude, selected?.destination?.longitude]);
  const zoom = (amount:number) => {
    if (map.current) map.current.zoomTo((map.current.getZoom() ?? 4) + amount, { duration:250 });
    else setFallbackView((current) => ({ ...current, zoom: Math.max(2, Math.min(18, current.zoom + amount)) }));
  };
  const reset = () => {
    if (map.current) map.current.flyTo({ center:[8,49], zoom:4.4, duration:500 });
    else setFallbackView({ longitude: 8, latitude: 49, zoom: 4 });
  };
  const fitAircraft = () => {
    const located = flights.filter(isPosition);
    if (!located.length) return;
    if (!map.current) {
      setFallbackView((current) => ({
        ...current,
        longitude: located.reduce((sum, flight) => sum + flight.longitude, 0) / located.length,
        latitude: located.reduce((sum, flight) => sum + flight.latitude, 0) / located.length,
      }));
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    located.forEach((f) => bounds.extend([f.longitude,f.latitude]));
    map.current?.fitBounds(bounds, { padding:75, maxZoom:7, duration:450 });
  };
  return <section className="map-frame" aria-label="Live aircraft map">
    <div ref={host} className="map-host" />
    {mapFailed && <RasterFallback flights={flights} selectedId={selectedId} onSelect={onSelect} positions={positions} playbackIndex={playbackIndex} view={fallbackView} onViewChange={setFallbackView} />}
    {!ready && !mapFailed && <div className="map-loading"><span className="skeleton loading-map-skeleton" />Loading map tiles…</div>}
    <div className="map-scale"><span className="scale-dot"/> Aircraft positions <span className="scale-rule"/> Current track</div>
    <div className="map-controls" aria-label="Map controls">
      <button aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1)}><Plus size={16}/></button>
      <button aria-label="Zoom out" title="Zoom out" onClick={() => zoom(-1)}><Minus size={16}/></button>
      <span className="control-separator"/>
      <button aria-label="Fit aircraft" title="Fit aircraft" onClick={fitAircraft}><Crosshair size={16}/></button>
      <button aria-label="Reset view" title="Reset view" onClick={reset}><RotateCcw size={15}/></button>
    </div>
  </section>;
}
