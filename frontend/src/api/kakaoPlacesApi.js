function loadKakaoMapScript() {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
      resolve()
      return
    }

    const apiKey = process.env.REACT_APP_KAKAO_JAVASCRIPT_KEY

    if (!apiKey) {
      reject(new Error('REACT_APP_KAKAO_JAVASCRIPT_KEY가 없습니다.'))
      return
    }

    const existingScript = document.getElementById('kakao-map-sdk')

    if (existingScript) {
      existingScript.onload = () => {
        resolve()
      }

      existingScript.onerror = () => {
        reject(new Error('카카오맵 SDK 로드 실패'))
      }

      return
    }

    const script = document.createElement('script')
    script.id = 'kakao-map-sdk'
    script.type = 'text/javascript'
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services`

    script.onload = () => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
        resolve()
      } else {
        reject(new Error('카카오맵 services 객체가 생성되지 않았습니다.'))
      }
    }

    script.onerror = () => {
      reject(new Error('카카오맵 SDK script 로드 실패'))
    }

    document.head.appendChild(script)
  })
}