import { useState } from "react";
import GoogleMapView from "./GoogleMapView";
import CurrentLocationButton from "./CurrentLocationButton";
import { getCurrentPosition } from "../../services/geolocationService";
import { saveMyLocation } from "../../api/mapApi";

function MapPage() {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [message, setMessage] = useState("");

  const handleCurrentLocation = async () => {
    try {
      setMessage("현재 위치를 가져오는 중입니다.");

      const location = await getCurrentPosition();

      setCurrentLocation(location);
      setMessage("현재 위치를 가져왔습니다.");

      try {
        await saveMyLocation({
          latitude: location.lat,
          longitude: location.lng,
          accuracy: location.accuracy,
        });

        setMessage("현재 위치를 가져오고 서버에 저장했습니다.");
      } catch (error) {
        console.error(error);
        setMessage("현재 위치는 가져왔지만 서버 저장은 실패했습니다.");
      }
    } catch (error) {
      console.error(error);
      setMessage("현재 위치를 가져오지 못했습니다.");
    }
  };

  return (
    <section className="map-section">
      <h2>지도 기능</h2>

      <CurrentLocationButton onClick={handleCurrentLocation} />

      {message && <p>{message}</p>}

      {currentLocation && (
        <div className="location-box">
          <p>위도: {currentLocation.lat}</p>
          <p>경도: {currentLocation.lng}</p>
          <p>정확도: {Math.round(currentLocation.accuracy)}m</p>
        </div>
      )}

      <GoogleMapView currentLocation={currentLocation} />
    </section>
  );
}

export default MapPage;