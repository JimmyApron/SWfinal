import { useEffect, useRef, useState } from "react";

function GoogleMapView({ currentLocation }) {
  const mapRef = useRef(null);
  const mapObjectRef = useRef(null);
  const markerRef = useRef(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    loadGoogleMapScript()
      .then(() => {
        setIsMapReady(true);
      })
      .catch((error) => {
        console.error(error);
        setMapError("구글맵을 불러오지 못했습니다.");
      });
  }, []);

  useEffect(() => {
    if (!isMapReady || !mapRef.current || mapObjectRef.current) {
      return;
    }

    const defaultLocation = {
      lat: 35.1796,
      lng: 129.0756,
    };

    mapObjectRef.current = new window.google.maps.Map(mapRef.current, {
      center: defaultLocation,
      zoom: 15,
    });
  }, [isMapReady]);

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !currentLocation) {
      return;
    }

    const location = {
      lat: currentLocation.lat,
      lng: currentLocation.lng,
    };

    mapObjectRef.current.setCenter(location);

    if (markerRef.current) {
      markerRef.current.setMap(null);
    }

    markerRef.current = new window.google.maps.Marker({
      position: location,
      map: mapObjectRef.current,
      title: "내 위치",
    });
  }, [currentLocation, isMapReady]);

  if (mapError) {
    return <p>{mapError}</p>;
  }

  return (
    <div className="map-wrapper">
      {!isMapReady && <p>지도 불러오는 중...</p>}
      <div ref={mapRef} className="google-map" />
    </div>
  );
}

function loadGoogleMapScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      reject(new Error("REACT_APP_GOOGLE_MAPS_API_KEY가 없습니다."));
      return;
    }

    const existingScript = document.querySelector(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", resolve);
      existingScript.addEventListener("error", reject);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;

    script.onload = resolve;
    script.onerror = reject;

    document.head.appendChild(script);
  });
}

export default GoogleMapView;