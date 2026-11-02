# PixelFx to Unity

픽셀 아트 이펙트를 탐색하고 애니메이션과 스프라이트 시트를 확인한 뒤, Unity 에셋 패키지로 내보내는 웹 앱입니다.

## 웹 앱

[PixelFx to Unity 열기](https://dudwo2199.github.io/PixelFxToUnity/)

## 로컬 개발 실행

Node.js 18 이상이 필요합니다.

```powershell
npm install
npm run dev
```

Vite가 출력하는 로컬 주소를 브라우저에서 엽니다. 앱 런타임은 공식 PixelFx 사이트에 요청하지 않습니다. 배포용 정적 파일은 `npm run build`로 `dist/`에 생성되며, `main` 브랜치에 푸시하면 GitHub Actions가 GitHub Pages에 배포합니다.

## 기능

- 공식 갤러리의 232개 효과를 카테고리와 검색으로 탐색
- 현재 작업 중인 효과의 FPS(1~60)와 PixelFx 팔레트 프리셋 변경
- 효과별 변경 설정 자동 저장, JSON 설정 내보내기/불러오기, 효과별 초기화
- 선택한 효과 하나를 `.unitypackage`로 내보내기
- 패키지에 Multiple 모드로 슬라이스한 스프라이트 시트 PNG, PixelFx/Aseprite 형식 JSON, 시트 슬라이스를 참조하는 Unity 애니메이션 클립과 기본 상태로 설정한 Animator Controller 포함

에셋은 `src/vendor/pixelfx/`에 포함되어 있습니다. `npm run prebuild` 또는 `npm run predev`가 공식 소스 메타데이터에서 앱 카탈로그를 다시 생성합니다. 공식 저장소의 `moves` 카테고리 12개는 공유된 갤러리의 232개 범위에 포함되지 않아 앱 카탈로그에서 제외됩니다.

## 참고

Unity 패키지는 GUID별 `asset`, `asset.meta`, `pathname` 항목을 가진 gzip 압축 TAR로 생성합니다. 스프라이트 시트의 `.meta`에 프레임별 슬라이스를 정의하며, 생성된 `.anim`은 같은 시트 GUID와 각 슬라이스의 fileID를 참조하고 선택한 FPS를 샘플 레이트로 사용합니다. 효과별 Animator Controller는 해당 클립을 기본 상태로 사용합니다. Unity Editor에서 패키지 임포트 검증은 아직 수행하지 않았습니다.

PixelFx source code and effects are distributed under the MIT License. See `src/vendor/pixelfx/LICENSE` and `src/vendor/pixelfx/NOTICE.md`.
