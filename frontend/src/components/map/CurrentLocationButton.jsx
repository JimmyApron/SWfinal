function CurrentLocationButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="location-button">
      현재 위치 가져오기
    </button>
  );
}

export default CurrentLocationButton;