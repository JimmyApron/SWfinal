import { useEffect, useRef, useState } from 'react'

function GoogleMapView({ currentLocation, places = [], selectedPlace }) {
  const mapRef = useRef(null)
  const mapObjectRef = useRef(null)
  const userMarkerRef = useRef(null)
  const placeMarkerRefs = useRef([])
  const selectedInfoWindowRef = useRef(null)

  const [isMapReady, setIsMapReady] = useState(false)
  const [mapError, setMapError] = useState('')

  useEffect(() => {
    loadGoogleMapScript()
      .then(() => {
        setIsMapReady(true)
      })
      .catch((error) => {
        console.error(error)
        setMapError('구글맵을 불러오지 못했습니다.')
      })
  }, [])

  useEffect(() => {
    if (!isMapReady || !mapRef.current || mapObjectRef.current) {
      return
    }

    const defaultLocation = {
      lat: 35.1796,
      lng: 129.0756,
    }

    mapObjectRef.current = new window.google.maps.Map(mapRef.current, {
      center: defaultLocation,
      zoom: 15,
    })
  }, [isMapReady])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !currentLocation) {
      return
    }

    const location = {
      lat: currentLocation.lat,
      lng: currentLocation.lng,
    }

    mapObjectRef.current.setCenter(location)

    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null)
    }

    userMarkerRef.current = new window.google.maps.Marker({
      position: location,
      map: mapObjectRef.current,
      title: '내 위치',
      label: '나',
    })
  }, [currentLocation, isMapReady])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    placeMarkerRefs.current.forEach((marker) => marker.setMap(null))
    placeMarkerRefs.current = []

    places.forEach((place, index) => {
      if (!place.lat || !place.lng) {
        return
      }

      const marker = new window.google.maps.Marker({
        position: {
          lat: place.lat,
          lng: place.lng,
        },
        map: mapObjectRef.current,
        title: place.name,
        label: String(index + 1),
      })

      marker.addListener('click', () => {
        openPlaceInfoWindow(place, marker)
      })

      placeMarkerRefs.current.push(marker)
    })
  }, [places, isMapReady])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !selectedPlace) {
      return
    }

    if (!selectedPlace.lat || !selectedPlace.lng) {
      console.log('선택한 장소 좌표가 없습니다:', selectedPlace)
      return
    }

    const selectedLocation = {
      lat: selectedPlace.lat,
      lng: selectedPlace.lng,
    }

    mapObjectRef.current.setCenter(selectedLocation)
    mapObjectRef.current.setZoom(17)

    const matchedMarker = placeMarkerRefs.current.find((marker) => {
      const markerPosition = marker.getPosition()

      if (!markerPosition) {
        return false
      }

      return (
        markerPosition.lat() === selectedPlace.lat &&
        markerPosition.lng() === selectedPlace.lng
      )
    })

    if (matchedMarker) {
      openPlaceInfoWindow(selectedPlace, matchedMarker)
    } else {
      const marker = new window.google.maps.Marker({
        position: selectedLocation,
        map: mapObjectRef.current,
        title: selectedPlace.name,
      })

      openPlaceInfoWindow(selectedPlace, marker)
    }
  }, [selectedPlace, isMapReady])

  const openPlaceInfoWindow = (place, marker) => {
    if (selectedInfoWindowRef.current) {
      selectedInfoWindowRef.current.close()
    }

    selectedInfoWindowRef.current = new window.google.maps.InfoWindow({
      content: `
        <div>
          <strong>${place.name}</strong>
          <p>${place.address || '주소 정보 없음'}</p>
          <p>평점: ${place.rating || '정보 없음'} / 리뷰 수: ${place.reviewCount || 0}</p>
        </div>
      `,
    })

    selectedInfoWindowRef.current.open({
      map: mapObjectRef.current,
      anchor: marker,
    })
  }

  if (mapError) {
    return <p>{mapError}</p>
  }

  return (
    <div>
      {!isMapReady && <p>지도 불러오는 중...</p>}

      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '500px',
          border: '1px solid black',
        }}
      />
    </div>
  )
}

function loadGoogleMapScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve()
      return
    }

    const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY

    if (!apiKey) {
      reject(new Error('.env 파일에 REACT_APP_GOOGLE_MAPS_API_KEY가 없습니다.'))
      return
    }

    const existingScript = document.querySelector(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    )

    if (existingScript) {
      existingScript.addEventListener('load', resolve)
      existingScript.addEventListener('error', reject)
      return
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`
    script.async = true
    script.defer = true

    script.onload = resolve
    script.onerror = reject

    document.head.appendChild(script)
  })
}

export default GoogleMapView