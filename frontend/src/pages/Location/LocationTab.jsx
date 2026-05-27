import MapPage from "../../components/map/MapPage";
import { useParams } from "react-router-dom";

function LocationTab() {
  const { roomid } = useParams();

  return <MapPage roomId={roomid} />;
}

export default LocationTab;
