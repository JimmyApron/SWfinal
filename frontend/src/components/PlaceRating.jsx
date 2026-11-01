export default function PlaceRating({ rating }) {
  const value = rating == null || rating === '' ? NaN : Number(rating);
  if (!Number.isFinite(value) || value < 0 || value > 5) {
    return <span style={{ fontSize: 12, color: '#8A8A96', fontWeight: 400 }}>평점 정보 없음</span>;
  }
  return <span role="img" aria-label={`평점 ${value.toFixed(1)}점, 5점 만점`}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 12, fontWeight: 500 }}>
    <span aria-hidden="true" style={{ position: 'relative', display: 'inline-block', color: '#D5D5DE', fontSize: 15, lineHeight: 1.2 }}>
      ★★★★★
      <span style={{ position: 'absolute', left: 0, top: 0, width: `${value / 5 * 100}%`, overflow: 'hidden', whiteSpace: 'nowrap', color: '#F5B301' }}>★★★★★</span>
    </span>
    <span aria-hidden="true" style={{ color: '#6650B0' }}>{value.toFixed(1)}</span>
  </span>;
}
