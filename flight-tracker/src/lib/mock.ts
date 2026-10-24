import type { FlightPosition, LiveFlight, HistoricalFlight } from './types';
export const mockFlights: LiveFlight[] = [
  { id:'demo-1', icao24:'4ca8e2', callsign:'SAS842', flightNumber:'SK842', registration:'SE-RSD', aircraftType:'commercial', aircraftModel:'Airbus A320neo', operator:'Scandinavian Airlines', latitude:51.31, longitude:4.92, altitude:35000, speed:438, heading:145, verticalRate:0, squawk:'6432', origin:{icao:'EGLL',iata:'LHR',name:'London Heathrow'}, destination:{icao:'ESSA',iata:'ARN',name:'Stockholm Arlanda'}, status:'airborne', positionTimestamp:new Date().toISOString(), updatedAt:new Date().toISOString() },
  { id:'demo-2', icao24:'3c65a1', callsign:'DLH7VK', flightNumber:'LH2472', registration:'D-AIXM', aircraftType:'commercial', aircraftModel:'Airbus A321neo', operator:'Lufthansa', latitude:50.12, longitude:8.68, altitude:12000, speed:270, heading:278, verticalRate:1200, squawk:'2143', origin:{icao:'EDDF',iata:'FRA',name:'Frankfurt'}, destination:{icao:'EGLL',iata:'LHR',name:'London Heathrow'}, status:'airborne', positionTimestamp:new Date().toISOString() },
  { id:'demo-3', icao24:'a1b2c3', callsign:'FDX18', flightNumber:'FX18', registration:'N890FD', aircraftType:'cargo', aircraftModel:'Boeing 777F', operator:'FedEx Express', latitude:48.86, longitude:2.37, altitude:38000, speed:491, heading:312, verticalRate:0, squawk:'5117', origin:{icao:'KJFK',iata:'JFK',name:'New York JFK'}, destination:{icao:'EDDF',iata:'FRA',name:'Frankfurt'}, status:'airborne', positionTimestamp:new Date().toISOString() },
  { id:'demo-4', callsign:'EZY24AB', flightNumber:'U22401', aircraftType:'commercial', aircraftModel:'Airbus A319', operator:'easyJet', latitude:52.48, longitude:-1.89, altitude:28000, speed:402, heading:192, origin:{icao:'EGKK',iata:'LGW',name:'London Gatwick'}, destination:{icao:'LEBL',iata:'BCN',name:'Barcelona'}, status:'airborne', positionTimestamp:new Date().toISOString() },
  { id:'demo-5', callsign:'N71XT', aircraftType:'general-aviation', aircraftModel:'Cessna 172', latitude:49.21, longitude:2.55, altitude:4500, speed:112, heading:87, status:'airborne', positionTimestamp:new Date().toISOString() },
];
export const mockHistory: HistoricalFlight[] = mockFlights.map((f, i) => ({ ...f, id:`journey-${i+1}`, departureTime:new Date(Date.now()-((i+1)*3600_000)).toISOString(), arrivalTime:new Date(Date.now()-((i+1)*1200_000)).toISOString() }));
export function mockPositions(flight: HistoricalFlight): FlightPosition[] {
  const lat = flight.latitude ?? 50, lon = flight.longitude ?? 5;
  return Array.from({length: 18}, (_, i) => ({
    timestamp: new Date(Date.now() - (17-i)*60_000).toISOString(),
    latitude: lat + Math.sin(i/4)*0.32 - 0.14,
    longitude: lon + (i/17)*1.4 - 0.7,
    altitude: (flight.altitude ?? 28000) - Math.sin(i/17*Math.PI)*1200,
    speed: flight.speed ?? 420,
    heading: flight.heading ?? 105,
  }));
}
