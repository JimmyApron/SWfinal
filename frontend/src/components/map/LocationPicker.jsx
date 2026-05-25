import { useEffect, useRef, useState } from "react";

function loadKakaoScript() {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
      resolve();
      return;
    }
    reject(new Error("카카오맵이 로드되지 않았습니다."));
  });
}

function LocationPicker({ onSelect }) {
  const mapRef = useRef(null);
  const mapObjectRef = useRef(null);
  const markerRef = useRef(null);

  const [isReady, setIsReady] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadKakaoScript()
      .then(() => setIsReady(true))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isReady || !mapRef.current || mapObjectRef.current) return;

    const map = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(37.5665, 126.9780),
      level: 5,
    });
    mapObjectRef.current = map;

    window.kakao.maps.event.addListener(map, "click", (mouseEvent) => {
      const latlng = mouseEvent.latLng;
      placeMarker(latlng.getLat(), latlng.getLng());

      const geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.coord2Address(latlng.getLng(), latlng.getLat(), (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const road = result[0].road_address?.address_name || "";
          const jibun = result[0].address?.address_name || "";
          const addr = road || jibun;
          onSelect(addr, "");
        }
      });
    });
  }, [isReady, onSelect]);

  const placeMarker = (lat, lng) => {
    const map = mapObjectRef.current;
    if (!map) return;

    if (markerRef.current) markerRef.current.setMap(null);

    const marker = new window.kakao.maps.Marker({
      position: new window.kakao.maps.LatLng(lat, lng),
    });
    marker.setMap(map);
    markerRef.current = marker;
    map.setCenter(new window.kakao.maps.LatLng(lat, lng));
  };

  const handleSearch = () => {
    if (!keyword.trim()) return;
    setSearching(true);
    setResults([]);

    const placesService = new window.kakao.maps.services.Places();
    placesService.keywordSearch(keyword, (data, status) => {
      setSearching(false);
      if (status === window.kakao.maps.services.Status.OK) {
        setResults(data.map((p) => ({
          id: p.id,
          name: p.place_name,
          address: p.road_address_name || p.address_name || "",
          lat: Number(p.y),
          lng: Number(p.x),
        })));
      } else if (status === window.kakao.maps.services.Status.ZERO_RESULT) {
        setResults([]);
      } else {
        alert("검색 실패");
      }
    });
  };

  const handleSelectResult = (place) => {
    placeMarker(place.lat, place.lng);
    onSelect(place.name, place.address);
    setResults([]);
    setKeyword(place.name);
  };

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <input
          type="text"
          placeholder="장소 검색 (예: 홍대입구역)"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{
            flex: 1, padding: "10px 12px", fontSize: "14px",
            border: "1px solid #ddd", borderRadius: "10px",
          }}
        />
        <button
          onClick={handleSearch}
          disabled={searching}
          style={{
            padding: "10px 16px", backgroundColor: "#7c79ff", color: "#fff",
            border: "none", borderRadius: "10px", fontSize: "14px", cursor: "pointer",
          }}
        >
          검색
        </button>
      </div>

      {results.length > 0 && (
        <div style={{
          border: "1px solid #eee", borderRadius: "10px",
          marginBottom: "8px", maxHeight: "180px", overflowY: "auto",
        }}>
          {results.map((place) => (
            <div
              key={place.id}
              onClick={() => handleSelectResult(place)}
              style={{
                padding: "10px 14px", borderBottom: "1px solid #f0f0f0",
                cursor: "pointer", fontSize: "14px",
              }}
            >
              <p style={{ margin: 0, fontWeight: "bold" }}>{place.name}</p>
              <p style={{ margin: 0, color: "#888", fontSize: "12px" }}>{place.address}</p>
            </div>
          ))}
        </div>
      )}

      <div
        ref={mapRef}
        style={{ width: "100%", height: "250px", borderRadius: "12px", overflow: "hidden" }}
      />
      <p style={{ fontSize: "12px", color: "#aaa", textAlign: "center", marginTop: "4px" }}>
        지도를 탭하거나 검색 결과를 선택하세요
      </p>
    </div>
  );
}

export default LocationPicker;
